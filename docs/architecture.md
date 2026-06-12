# nightdrift — architecture

Generative lofi for sleep. The app is a single-page Next.js client that runs a procedural Web Audio engine in the browser. There are no audio files, no backend, and no external synthesis libraries — every note is scheduled on the fly from oscillators and noise.

---

## Overview

nightdrift behaves like a late-night radio station: it drifts through generated **scenes** (key, progression, tempo, motif, band, ambience, and a poetic name), plays each for a few 8-bar rounds with an energy arc, then segues seamlessly into the next scene. The listener can steer mood, volume, vinyl crackle, and a sleep timer; lock-screen and headset controls mirror the main play/stop button.

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (client-only)                   │
│                                                                 │
│  ┌──────────────┐    ┌─────────────────┐    ┌───────────────┐   │
│  │  React UI    │◄───│  useNightdrift  │───►│ Media Session │   │
│  │  (Nightdrift)│    │  hook           │    │ (lock screen) │   │
│  └──────┬───────┘    └────────┬────────┘    └───────────────┘   │
│         │                       │                               │
│         │              ┌────────▼────────┐                      │
│         │              │ PlaybackSink    │                      │
│         │              │ (hidden <audio>)│                      │
│         │              └────────┬────────┘                      │
│         │                       │ MediaStream                   │
│         │              ┌────────▼────────┐                      │
│         └──────────────►│ NightdriftEngine │                    │
│            scene/progress│  (Web Audio)   │                     │
│                          └────────────────┘                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tech stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS 4 |
| Audio | Raw Web Audio API — no Tone.js, no samples |
| Language | TypeScript throughout |
| Deployment | Static/client bundle; no server routes or database |

The audio engine **must** be constructed after user interaction (browser autoplay policy). `createEngine()` is only called from the `useNightdrift` hook when the user taps **begin**.

---

## Repository layout

```
nightdrift/
├── app/                    # Next.js App Router
│   ├── layout.tsx          # fonts, metadata, PWA manifest link
│   ├── page.tsx            # renders <Nightdrift />
│   └── globals.css         # theme tokens, animations
├── components/nightdrift/  # UI shell
│   ├── nightdrift.tsx      # main layout + controls
│   ├── halo-button.tsx     # play/stop + scene progress ring
│   ├── pill.tsx            # toggle chips (mood, timer, crackle)
│   └── starfield.tsx       # decorative background
├── hooks/
│   └── use-nightdrift.ts   # bridges React state ↔ audio engine
├── lib/audio/              # entire generative engine (see below)
└── public/
    ├── manifest.webmanifest
    └── icon.svg
```

All generative logic lives under `lib/audio/`. The React layer is thin: it owns playback lifecycle, user settings, sleep timer, and now-playing metadata.

---

## Application layer

### Entry and layout

`app/page.tsx` renders a single client component. `app/layout.tsx` sets SEO metadata, links the web app manifest, configures Geist fonts, and applies the dark night-sky theme color.

### `useNightdrift` hook

The hook is the only place that touches the engine. It:

1. **Starts** — disposes any prior engine, creates a new one with current mood/crackle, resumes `AudioContext`, attaches the playback stream to a hidden `<audio>` element (falls back to direct `AudioContext` output if that fails).
2. **Stops** — fades master gain, disposes the engine after the fade, clears media session metadata.
3. **Mirrors settings** — mood, volume, and crackle are kept in refs so `start()` always reads fresh values without stale closures.
4. **Sleep timer** — counts down in wall-clock seconds; begins a long fade over the final minute, then stops playback.
5. **Scene progress** — polls `engine.getSceneProgress()` on `requestAnimationFrame` while playing, driving the halo button's progress ring.
6. **Media session** — binds play/pause/stop from lock screen and headset buttons to the same start/stop handlers.

Engine lifetime is tied to a play session: stopping disposes the context entirely; starting creates a fresh engine and a new first scene.

### UI components

| Component | Role |
|-----------|------|
| `Nightdrift` | Page shell: header, halo button, now-playing readout, footer controls |
| `HaloButton` | Primary control; SVG progress ring for the scene, a counter-clockwise sleep-timer ring (remaining / 60 m), plus one concentric ring per active channel (from `scene.lineup`) glowing with live amplitude polled via `getChannelLevels()` on its own rAF loop |
| `NoiseOverlay` | Full-screen film grain (canvas-generated tile) that fades in while vinyl crackle is on during playback |
| `Pill` | Reusable active/inactive chip for mood, timer, and crackle toggles |
| `Starfield` | CSS-animated background stars |

The page background tint is per-mood: `--mood-dusk` (registered via `@property`) feeds the radial gradient and cross-fades over 4 s when the mood changes.

Controls map directly to hook methods: mood → `setMood`, volume → `setVolumeDb`, timer → `setTimer`, crackle → `setCrackleOn`.

---

## Audio engine

The engine (`lib/audio/engine.ts`) is a closure around an `AudioContext` and a lookahead scheduler. It exports `createEngine(config)` and the `NightdriftEngine` interface.

### Design principles

- **One-shot voices** — every note is a short-lived oscillator or noise burst scheduled ahead of time. Nothing holds long-lived synth voices, which keeps scheduling simple and memory bounded.
- **Lookahead scheduling** — a 30 ms interval tick schedules events up to ~150 ms ahead (45 s when the tab is hidden, so background tabs don't run dry).
- **Scene as the unit of variety** — harmony, tempo, instrumentation, ambience, and mix character all change at scene boundaries, not mid-bar.
- **Segue, not hard cut** — drums fade on a dedicated bus, ambience and reverb crossfade, tape character morphs, and tempo changes land in beatless intro/outro rounds.

### Signal graph

```
Voices (one-shots)
  │
  ├─ chords / melody / bass ──► role buses ──► tape (lowpass) ──► mix dynamics ──► master ──► MediaStreamDestination
  │                                  │              │                ▲
  │                                  │              └── reverb send ──┘ (return feeds mix bus)
  │                                  └── analysers (per-channel meters for the band stage UI)
  │
  ├─ drums ──► drum dynamics ──► master   (+ analyser)
  ├─ undertone (sub) ──► master
  ├─ vinyl hiss / pops ──► master
  └─ ambience beds ──► ambience bus ──► master   (+ analyser)

master ──► ctx.destination (fallback if PlaybackSink unavailable)
```

Each band role (chords, melody, bass) plays through its own gain bus into the
tape filter, and an `AnalyserNode` taps each role bus plus drums and ambience.
`getChannelLevels()` returns live RMS per channel (0–1) so the UI can animate
the band.

Supporting nodes:

| Module | File | Purpose |
|--------|------|---------|
| Mix dynamics | `dynamics.ts` | Glue compression + scheduled sidechain duck on kicks/bass |
| Drum dynamics | `dynamics.ts` | Light compression on the drum bus |
| Scene reverb | `reverb.ts` | Dual convolver crossfade; per-scene wet/decay/damp |
| Tape wobble | `engine.ts` | Slow LFO → oscillator detune (vinyl pitch drift) |
| Ambience | `ambience.ts` | Looping filtered-noise beds (rain, wind, city, fire) |

### Scheduler model

Timing constants:

| Constant | Value | Meaning |
|----------|-------|---------|
| `STEPS` | 32 | Sixteenth notes per chord (two 4/4 bars) |
| `CHORDS_PER_ROUND` | 4 | Chords per progression pass |
| Scene `rounds` | 3–5 (random) | Full 8-bar passes before segue |

Each tick advances `step` (0–31). When `step === 0`, a new chord begins: comping, optional pad, undertone, melody, and drum/bass patterns are scheduled for that two-bar window. Swing pushes odd sixteenths late.

**Energy arc** across a scene:

- Round 0 — beatless intro; energy ramps chord by chord
- Middle rounds — full groove, alternating A/B intensity
- Final round — thinning outro; drums dissolve on the last chord

**Segue trigger** — at the start of a chord when `round >= scene.rounds`, or when the user changed mood (`setMood` sets `pendingMood` and eases drums down until the next chord boundary).

Scene duration (for UI progress):

```
duration = rounds × CHORDS_PER_ROUND × STEPS × (60 / bpm / 4) seconds
```

`getSceneProgress()` returns elapsed fraction (0–1) from `AudioContext.currentTime` vs. `sceneStartedAt`.

### Scenes (`scenes.ts`)

A **scene** is one imaginary track. `makeScene(family, prev?)` picks:

- Key center and chord progression from the mood **family** config
- A **voicing style** (cozy clusters / open spreads / smoky shells) — chords are then **voice-led**: each chord voiced to move minimally from the previous one
- BPM, swing, a melodic **theme** (motif), its answer shift, and a per-scene **variation order** (lift / displaced / ornament) cycled through the middle rounds
- A two-bar **bass riff** locked to the band's kick pattern (used by the "groove" bass style)
- A **band** (see below) and resolved bass style
- Ambience bed and tape/reverb palette
- A unique poetic **name** (never the same as the previous scene)

Three mood families (`moods.ts`): **mellow** (warm major study-beats), **jazzy** (ii–V–I smoky), **rainy** (minor, slower). Each family defines allowed keys, progressions, scale pools, BPM ranges, and name lists.

`SceneSummary` is the UI-facing subset: name, family, key, bpm, rounds, band display name, chord symbols, and the **lineup** (chord/melody/bass voices, kit, ambience bed) that drives the band stage.

### Bands (`bands.ts`)

A **band** bundles who plays what and how:

| Axis | Options |
|------|---------|
| Chord voice | EP, FM EP, organ, guitar, vibraphone, strings, pluck, marimba, choir, horn |
| Comping style | rolled, sustained, stabs, arp, broken |
| Melody voice + behavior | motif, arp, held, sparse |
| Bass | sine/pluck/bass guitar/none × anchor/walking/groove |
| Drums | One of five **kit grammars** (boom-bap, slow-motion, bossa, brushes, heartbeat) |

`assembleBand()` weighted-picks by mood family, avoids repeating the same band back-to-back, and ~30% of the time swaps in a **guest** melody instrument (`"tape quartet ft. clarinet"`).

Kit grammars are step-indexed patterns over the 32 sixteenth steps — kicks, backbeat voice, pulse (hat/shaker/brush), ghosts, fills.

### Voices (`voices.ts`)

`createVoices(buses)` returns play functions for every instrument and one-shot effect. Each function:

1. Creates oscillators or noise sources
2. Connects through envelopes/filters to the appropriate bus (`tape`, `drums`, `undertone`, `pops`, or direct `master`)
3. Starts and stops at scheduled `AudioContext` times

Melodic voices share tape wobble via `wobbleAmt`. Ambient one-shots (thunder, train horn, owl, chimes, crickets, needle drop) also live here.

### Ambience (`ambience.ts`)

Environmental beds sit under the music — present enough to hear, not loud enough to compete. Each bed is looped, filtered noise with slow LFO movement (rain adds a high droplet-patter layer so it reads as rain over the mix). `set(spec, time, fast?)` crossfades bed level at scene segues. `sparkle(t)` fires per-step grain (e.g. fire crackles). Bed choice is weighted by mood family; most scenes carry a bed.

### Randomness (`random.ts`)

Shared helpers: `pick`, `rand`, `randInt`, `chance`, `weightedPick`. All generative layers use these; there is no seeded RNG — every session is unique.

### Pitch math (`notes.ts`)

Equal temperament from note names (`"F#3"`), MIDI conversion, `dbToGain` for volume.

---

## Platform integration

### Background playback (`playback-sink.ts`)

Mobile OSes suspend bare `AudioContext` output when the screen locks. The engine renders to a `MediaStreamDestination`; `PlaybackSink` attaches that stream to a hidden `<audio playsinline>` element so the OS treats playback as media. If `play()` fails, the hook falls back to `connectDirectOutput()`.

### Media Session API (`media-session.ts`)

When playing, metadata is updated with the scene name, band, key, and BPM. Play/pause/stop actions on lock screen and headsets call the same handlers as the halo button.

### PWA (`public/manifest.webmanifest`)

Standalone display, dark theme, SVG icon. Enables add-to-home-screen on mobile without a service worker (none currently).

---

## Data and control flow

### Start playback

```
User taps "begin"
  → useNightdrift.start()
  → createEngine({ mood, crackle, onSceneChange })
  → engine.start(volumeDb)
  → PlaybackSink.attach(playbackStream)
  → onSceneChange(first scene summary)
  → setPlaying(true)
  → rAF loop begins (sceneProgress)
  → bindMediaSession already active
```

### Mood change while playing

```
User selects "Rainy"
  → setMood("rainy")
  → engine.setMood("rainy")  // sets pendingMood, eases drums
  → at next chord boundary: makeScene("rainy") → beginScene()
  → onSceneChange(new summary)
  → sceneProgress resets (new sceneStartedAt)
```

### Stop playback

```
User taps stop / lock-screen pause / sleep timer expires
  → engine.fadeOut(secs)
  → after fade: engine.dispose(), sink.detach()
  → clearMediaSession()
  → setPlaying(false), sceneProgress → 0
```

---

## Key design decisions

1. **No audio assets** — infinite variety without CDN bandwidth or copyright concerns; tradeoff is CPU synthesis and no realistic acoustic samples.
2. **Engine per session** — simplifies lifecycle; a stopped session fully releases the audio context.
3. **Ref-mirrored settings in the hook** — `start()` is stable in `useCallback` deps while still reading latest mood/volume/crackle.
4. **Separate drum bus** — segues, mood transitions, and beatless dropouts fade drums independently of the melodic mix.
5. **Dual convolver reverb** — decay/time changes crossfade without clicks at scene boundaries.
6. **Hidden-tab lookahead** — 45 s buffer prevents scheduler underruns when the tab is backgrounded.
7. **Client-only architecture** — no API routes, auth, or persistence; state resets on refresh.

---

## Extension points

| Goal | Likely touch points |
|------|---------------------|
| New mood family | `moods.ts`, `FAMILIES` in `scenes.ts`, band weights in `bands.ts`, ambience weights in `ambience.ts` |
| New instrument | Voice function in `voices.ts`, add to `ChordVoice` / `MelodyVoice` unions in `bands.ts`, wire in engine dispatch tables |
| New drum feel | Kit grammar in `KITS` (`bands.ts`) |
| New ambience bed | Bed definition in `ambience.ts`, optional event in `maybePlayEvent` (`engine.ts`) |
| Persist settings | Read/write mood/volume/timer in `use-nightdrift.ts` (localStorage or URL params) |
| Share a seed | Replace `Math.random` in `random.ts` with a seeded PRNG; thread seed through `makeScene` |
| Analytics / logging | Hook into `onSceneChange` in `EngineConfig` |

---

## Running locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Audio requires a user gesture before the first `AudioContext` start.

Build for production: `npm run build` → `npm start`.
