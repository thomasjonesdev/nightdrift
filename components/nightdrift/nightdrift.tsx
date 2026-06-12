"use client";

import { useSyncExternalStore } from "react";
import { useNightdrift } from "@/hooks/use-nightdrift";
import { MOODS, TIMERS, type MoodKey } from "@/lib/audio/moods";
import { pick } from "@/lib/audio/random";
import DriftPresence from "./drift-presence";
import HaloButton from "./halo-button";
import NoiseOverlay from "./noise-overlay";
import Pill from "./pill";
import Starfield from "./starfield";

// dusk tint at the top of the sky, per mood — warm plum, smoky blue, rain slate
const MOOD_DUSK: Record<MoodKey, string> = {
  mellow: "#1e152a",
  jazzy: "#121a31",
  rainy: "#0e1d27",
};

const TAGLINES = {
  morning: [
    "take your time waking into today",
    "no rush — the morning can wait",
    "breathe before the day begins",
    "start slow, you've got all day",
  ],
  afternoon: [
    "pause here — the day's still yours",
    "somewhere in the middle of your day",
    "you've earned a quiet moment",
    "let the afternoon soften a little",
  ],
  evening: [
    "let the weight of the day ease off",
    "you made it through — now unwind",
    "leave today behind, slowly",
    "the evening is yours to settle into",
  ],
  night: [
    "close the day, gently",
    "it's okay to stop now",
    "whatever today was, you can let it go",
    "rest — tomorrow isn't here yet",
    "the day is done; drift off when you're ready",
  ],
} as const;

function periodForHour(hour: number): keyof typeof TAGLINES {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

let clientTagline: string | null = null;

function subscribeTagline(onChange: () => void) {
  if (clientTagline === null) {
    clientTagline = pick(TAGLINES[periodForHour(new Date().getHours())]);
    onChange();
  }
  return () => {};
}

function getTagline() {
  return clientTagline ?? "";
}

function useTagline() {
  return useSyncExternalStore(subscribeTagline, getTagline, () => "");
}

function formatTime(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = String(totalSeconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function ControlRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-wrap items-center gap-3.5">
      <span className="w-[90px] shrink-0 font-sans text-xs uppercase tracking-[0.16em] text-haze-dim">
        {label}
      </span>
      {children}
    </section>
  );
}

export default function Nightdrift() {
  const tagline = useTagline();

  const {
    playing, start, stop,
    mood, setMood,
    volumeDb, setVolumeDb,
    crackleOn, setCrackleOn,
    timerMin, setTimer, remaining, timerProgress,
    scene, sceneProgress, getChannelLevels,
  } = useNightdrift();

  return (
    <div
      className="mood-bg relative flex min-h-screen flex-col items-center overflow-hidden font-display text-ink"
      style={{ "--mood-dusk": MOOD_DUSK[mood] } as React.CSSProperties}
    >
      <Starfield />
      <NoiseOverlay active={crackleOn} />

      <header className="z-10 pt-11 text-center">
        <div className="text-[26px] lowercase tracking-[0.1em] text-parchment opacity-50">- nightdrift -</div>
        <div className="mt-2.5 min-h-lh font-sans text-xs uppercase tracking-[0.2em] text-haze">
          {tagline}
        </div>
      </header>

      <main className="z-10 flex flex-1 flex-col items-center justify-center py-5">
        <HaloButton
          playing={playing}
          progress={sceneProgress}
          lineup={scene?.lineup ?? null}
          getLevels={getChannelLevels}
          timerProgress={timerProgress}
          onClick={playing ? () => stop() : start}
        />

        <div className="mt-7 flex h-20 flex-col items-center gap-1.5">
          <DriftPresence show={playing && !!scene}>
            {scene && (
              <div
                key={scene.name}
                className="animate-drift-in motion-reduce:animate-none text-center"
              >
                <span className="text-[15px] italic tracking-[0.06em] text-parchment/90">
                  {scene.name}
                </span>
                <span className="mt-1 block font-sans text-[11px] uppercase tracking-[0.22em] text-haze">
                  {scene.band} · {scene.keyName} · {scene.bpm} bpm
                </span>
                <span className="mt-1 block font-sans text-[11px] uppercase tracking-[0.22em] text-haze">
                  {scene.progression.map((p) => p.name).join(" → ")}
                </span>
              </div>
            )}
          </DriftPresence>
          <DriftPresence show={remaining !== null}>
            {remaining !== null && (
              <div className="animate-drift-in motion-reduce:animate-none font-sans text-[13px] tracking-[0.08em] text-haze-soft">
                <span className="font-mono">{formatTime(remaining)}</span>
              </div>
            )}
          </DriftPresence>
        </div>
      </main>

      <footer className="z-10 flex w-full max-w-[520px] flex-col gap-[18px] px-6 pb-12">
        <ControlRow label="mood">
          <div className="flex flex-wrap gap-2">
            {(Object.entries(MOODS) as [MoodKey, (typeof MOODS)[MoodKey]][]).map(([key, m]) => (
              <Pill key={key} active={mood === key} onClick={() => setMood(key)} title={m.hint}>
                {m.label}
              </Pill>
            ))}
          </div>
        </ControlRow>

        <ControlRow label="sleep timer">
          <div className="flex flex-wrap gap-2">
            {TIMERS.map((t) => (
              <Pill key={t.label} active={timerMin === t.min} onClick={() => setTimer(t.min)}>
                {t.label}
              </Pill>
            ))}
          </div>
        </ControlRow>

        <ControlRow label="volume">
          <input
            type="range"
            min={-30}
            max={-4}
            step={1}
            value={volumeDb}
            onChange={(e) => setVolumeDb(Number(e.target.value))}
            className="volume-slider min-w-40 flex-1"
            aria-label="Volume"
          />
        </ControlRow>

        <ControlRow label="vinyl">
          <Pill
            active={crackleOn}
            onClick={() => setCrackleOn(!crackleOn)}
            aria-pressed={crackleOn}
          >
            {crackleOn ? "crackle on" : "crackle off"}
          </Pill>
        </ControlRow>
      </footer>
    </div>
  );
}
