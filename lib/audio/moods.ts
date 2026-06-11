// Mood families the user can steer between. Each family is a flavor of
// generated scene — the actual keys, progressions, and tempos are chosen
// per scene in scenes.ts.

export const MOODS = {
  mellow: {
    label: "Mellow",
    hint: "warm major, classic study-beats",
  },
  jazzy: {
    label: "Jazzy",
    hint: "ii–V–I, smoky",
  },
  rainy: {
    label: "Rainy",
    hint: "minor, slower, late night",
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
