// Filename parser for FreePats-style sample packs.
// Used at build time (catalog generator) — keep in sync with on-disk layouts.

import { midiFromNote } from "./notes";

export interface ParsedSampleFile {
  file: string;
  rootNote: string;
  rootMidi: number;
  /** Velocity / dynamic layer id (L, H, f, mf, 60, s2, …). */
  layer: string;
  roundRobin?: number;
}

const INTERVAL = /^[A-G][#b]?\d+-[A-G]/;

const PATTERNS: Array<{
  re: RegExp;
  parse: (m: RegExpMatchArray, file: string, defaultOctave: number) => ParsedSampleFile | null;
}> = [
  {
    re: /^([A-G][#b]?)(-?\d+)v([LH])\.(wav|flac|ogg)$/i,
    parse: (m, file) => ({
      file,
      rootNote: `${m[1]}${m[2]}`,
      rootMidi: midiFromNote(`${m[1]}${m[2]}`),
      layer: m[3].toUpperCase(),
    }),
  },
  {
    re: /^([A-G][#b]?)(-?\d+)v(\d+)\.(wav|flac|ogg)$/i,
    parse: (m, file) => ({
      file,
      rootNote: `${m[1]}${m[2]}`,
      rootMidi: midiFromNote(`${m[1]}${m[2]}`),
      layer: m[3],
    }),
  },
  {
    re: /^([A-G][#b]?)(-?\d+)_(f|mf|mp|ff)(\d+)\.(wav|flac|ogg)$/i,
    parse: (m, file) => ({
      file,
      rootNote: `${m[1]}${m[2]}`,
      rootMidi: midiFromNote(`${m[1]}${m[2]}`),
      layer: m[3].toLowerCase(),
      roundRobin: parseInt(m[4], 10),
    }),
  },
  {
    re: /^([A-G][#b]?)(-?\d+)_s(\d+)_(\d+)\.(wav|flac|ogg)$/i,
    parse: (m, file) => ({
      file,
      rootNote: `${m[1]}${m[2]}`,
      rootMidi: midiFromNote(`${m[1]}${m[2]}`),
      layer: "default",
      roundRobin: parseInt(m[4], 10),
    }),
  },
  {
    re: /^([A-G][#b]?)(-?\d+)_(\d+)\.(wav|flac|ogg)$/i,
    parse: (m, file) => ({
      file,
      rootNote: `${m[1]}${m[2]}`,
      rootMidi: midiFromNote(`${m[1]}${m[2]}`),
      layer: "default",
      roundRobin: parseInt(m[3], 10),
    }),
  },
  {
    re: /^([A-G][#b]?)(-?\d+)\.(wav|flac|ogg)$/i,
    parse: (m, file) => ({
      file,
      rootNote: `${m[1]}${m[2]}`,
      rootMidi: midiFromNote(`${m[1]}${m[2]}`),
      layer: "default",
    }),
  },
  {
    re: /^([A-G][#b]?)\.(wav|flac|ogg)$/i,
    parse: (m, file, defaultOctave) => {
      const rootNote = `${m[1]}${defaultOctave}`;
      return {
        file,
        rootNote,
        rootMidi: midiFromNote(rootNote),
        layer: "default",
      };
    },
  },
];

export function parseSampleFile(
  file: string,
  opts?: { defaultOctave?: number; skipIntervals?: boolean },
): ParsedSampleFile | null {
  const defaultOctave = opts?.defaultOctave ?? 3;
  if (opts?.skipIntervals !== false && INTERVAL.test(file)) return null;

  for (const { re, parse } of PATTERNS) {
    const m = file.match(re);
    if (m) return parse(m, file, defaultOctave);
  }
  return null;
}
