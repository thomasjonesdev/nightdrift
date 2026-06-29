// Mood families the user can steer between. Each family is a flavor of
// generated scene — the actual keys, progressions, and tempos are chosen
// per scene in scenes.ts.

export const MOODS = {
  mellow: {
    label: "Mellow",
    hint: "74–84 BPM, warm pocket groove",
  },
  jazzy: {
    label: "Jazzy",
    hint: "78–92 BPM, ii–V swing & stabs",
  },
  rainy: {
    label: "Rainy",
    hint: "56–66 BPM, slow rain & long reverb",
  },
} as const;

export type MoodKey = keyof typeof MOODS;

export const TIMERS = [
  { label: "Off", min: 0 },
  { label: "15m", min: 15 },
  { label: "30m", min: 30 },
  { label: "45m", min: 45 },
  { label: "60m", min: 60 },
] as const;
