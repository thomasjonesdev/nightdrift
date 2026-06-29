// Shared audio buffer loader — dedupes fetches, limits concurrency, caches decoded buffers.
// WAV + FLAC (via decodeAudioData on modern browsers).

const MAX_CONCURRENT = 4;

export interface SampleLoader {
  has(url: string): boolean;
  get(url: string): AudioBuffer | undefined;
  load(url: string): Promise<AudioBuffer>;
  /** Queue loads; high = start immediately, idle = spread via requestIdleCallback. */
  prefetch(urls: string[], priority: "high" | "idle"): void;
}

export function createSampleLoader(ctx: AudioContext): SampleLoader {
  const cache = new Map<string, AudioBuffer>();
  const inflight = new Map<string, Promise<AudioBuffer>>();
  const queue: Array<{ url: string; resolve: (b: AudioBuffer) => void; reject: (e: unknown) => void }> = [];
  let active = 0;
  const idleQueued = new Set<string>();

  function sampleUrl(basePath: string, file: string): string {
    return `${basePath}/${encodeURIComponent(file)}`;
  }

  async function decode(url: string): Promise<AudioBuffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Sample fetch failed ${url}: ${res.status}`);
    const data = await res.arrayBuffer();
    return ctx.decodeAudioData(data);
  }

  function pump() {
    while (active < MAX_CONCURRENT && queue.length > 0) {
      const job = queue.shift()!;
      active++;
      decode(job.url)
        .then((buf) => {
          cache.set(job.url, buf);
          job.resolve(buf);
        })
        .catch(job.reject)
        .finally(() => {
          active--;
          pump();
        });
    }
  }

  function enqueue(url: string): Promise<AudioBuffer> {
    const hit = cache.get(url);
    if (hit) return Promise.resolve(hit);
    const pending = inflight.get(url);
    if (pending) return pending;

    const p = new Promise<AudioBuffer>((resolve, reject) => {
      queue.push({ url, resolve, reject });
      pump();
    }).finally(() => {
      inflight.delete(url);
    });
    inflight.set(url, p);
    return p;
  }

  function prefetch(urls: string[], priority: "high" | "idle") {
    const todo = urls.filter((u) => !cache.has(u) && !inflight.has(u) && !idleQueued.has(u));
    if (todo.length === 0) return;

    if (priority === "high") {
      for (const url of todo) void enqueue(url);
      return;
    }

    for (const url of todo) idleQueued.add(url);
    let i = 0;

    const step = (deadline?: IdleDeadline) => {
      while (i < todo.length && (!deadline || deadline.timeRemaining() > 1)) {
        const url = todo[i++]!;
        idleQueued.delete(url);
        void enqueue(url);
      }
      if (i < todo.length) {
        if (typeof requestIdleCallback === "function") {
          requestIdleCallback(step, { timeout: 3000 });
        } else {
          setTimeout(() => step(), 32);
        }
      }
    };

    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(step, { timeout: 3000 });
    } else {
      step();
    }
  }

  return {
    has(url: string) {
      return cache.has(url);
    },
    get(url: string) {
      return cache.get(url);
    },
    load: enqueue,
    prefetch,
  };
}

/** Build a fetch URL from pack base path + relative filename. */
export function sampleFileUrl(basePath: string, file: string): string {
  return `${basePath}/${encodeURIComponent(file)}`;
}
