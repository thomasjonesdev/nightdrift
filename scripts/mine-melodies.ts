/**
 * mine-melodies — turn real MIDI tunes into nightdrift phrase templates.
 *
 * Pipeline (all offline, run once, curate the output by ear):
 *   1. Parse a .mid file with @tonejs/midi.
 *   2. Pick the melody track and reduce it to a single monophonic line (skyline).
 *   3. Detect the key with the Krumhansl–Schmuckler algorithm.
 *   4. Abstract each note into a key-agnostic contour cell: `rel` = diatonic
 *      scale-step offset from the phrase anchor, `step` = 16th position in the
 *      phrase's 2-bar window, `beats` = duration, plus accent/pickup hints.
 *   5. Label sections into one tune package (A/B/answer/tag from same source).
 *
 * Usage:
 *   npx tsx scripts/mine-melodies.ts <file.mid | dir> [options]
 *
 * Options:
 *   --mood <mellow|jazzy|rainy>   label the emitted block (default: mellow)
 *   --bars <n>                    phrase window length in bars (default: 2)
 *   --min-notes <n>               drop phrases shorter than this (default: 3)
 *   --max-cells <n>               split phrases longer than this (default: 8)
 *   --out <file.json>             write JSON instead of printing to stdout
 *
 * The output is intentionally a *candidate* set — keep the 2–4 strongest
 * phrases per id per mood, matching the curated size of the hand-authored
 * library, and audition them in the app before committing.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { Midi } from "@tonejs/midi";
import type { PhraseCell, PhraseTemplate } from "../lib/audio/melodies";
import { labelTuneSections } from "../lib/audio/tune-packages";

// ---- key detection -----------------------------------------------------------

// Krumhansl–Kessler tonal hierarchy profiles (major / minor), one weight per
// pitch class measured relative to the tonic.
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];
const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

interface DetectedKey {
  tonicPc: number;
  minor: boolean;
  confidence: number;
}

/** Pearson correlation between two equal-length vectors. */
function correlate(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  const meanA = a.reduce((s, x) => s + x, 0) / n;
  const meanB = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

/** Krumhansl–Schmuckler: correlate a duration-weighted PC histogram vs. all 24 keys. */
function detectKey(histogram: readonly number[]): DetectedKey {
  let best: DetectedKey = { tonicPc: 0, minor: false, confidence: -Infinity };
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = histogram.map((_, i) => histogram[(i + tonic) % 12]);
    const majCorr = correlate(rotated, KK_MAJOR);
    const minCorr = correlate(rotated, KK_MINOR);
    if (majCorr > best.confidence) best = { tonicPc: tonic, minor: false, confidence: majCorr };
    if (minCorr > best.confidence) best = { tonicPc: tonic, minor: true, confidence: minCorr };
  }
  return best;
}

// ---- midi -> note list -------------------------------------------------------

interface RawNote {
  midi: number;
  /** Onset in quarter-note beats. */
  beat: number;
  /** Duration in quarter-note beats. */
  beats: number;
  velocity: number;
}

/**
 * Choose the most melodic track: skip drums (channel 9), favour higher
 * register and fewer simultaneous notes (a real lead line is mostly mono).
 */
function pickMelodyTrack(midi: Midi): RawNote[] {
  let bestScore = -Infinity;
  let bestNotes: RawNote[] = [];
  const ppq = midi.header.ppq;

  for (const track of midi.tracks) {
    if (track.instrument.percussion || track.notes.length < 4) continue;
    const notes: RawNote[] = track.notes.map((n) => ({
      midi: n.midi,
      beat: n.ticks / ppq,
      beats: n.durationTicks / ppq,
      velocity: n.velocity,
    }));

    const meanPitch = notes.reduce((s, n) => s + n.midi, 0) / notes.length;
    // overlap penalty: how often a note starts before the previous one ends
    let overlaps = 0;
    const byTime = [...notes].sort((a, b) => a.beat - b.beat);
    for (let i = 1; i < byTime.length; i++) {
      if (byTime[i].beat < byTime[i - 1].beat + byTime[i - 1].beats - 1e-3) overlaps++;
    }
    const monoRatio = 1 - overlaps / notes.length;
    const score = meanPitch + monoRatio * 24;
    if (score > bestScore) {
      bestScore = score;
      bestNotes = byTime;
    }
  }
  return bestNotes;
}

/** Lowest non-percussion track — candidate bass line. */
function pickBassTrack(midi: Midi): RawNote[] {
  let bestMean = Infinity;
  let bestNotes: RawNote[] = [];
  const ppq = midi.header.ppq;

  for (const track of midi.tracks) {
    if (track.instrument.percussion || track.notes.length < 3) continue;
    const notes: RawNote[] = track.notes.map((n) => ({
      midi: n.midi,
      beat: n.ticks / ppq,
      beats: n.durationTicks / ppq,
      velocity: n.velocity,
    }));
    const meanPitch = notes.reduce((s, n) => s + n.midi, 0) / notes.length;
    if (meanPitch >= 52) continue;
    if (meanPitch < bestMean) {
      bestMean = meanPitch;
      bestNotes = [...notes].sort((a, b) => a.beat - b.beat);
    }
  }
  return skyline(bestNotes);
}

/** Collapse any remaining chords to a single top line (skyline). */
function skyline(notes: RawNote[]): RawNote[] {
  const out: RawNote[] = [];
  for (const n of notes) {
    const prev = out[out.length - 1];
    if (prev && n.beat < prev.beat + prev.beats - 1e-3) {
      // overlapping: keep the higher pitch, trim the earlier note
      if (n.midi > prev.midi) {
        prev.beats = Math.max(0, n.beat - prev.beat);
        out.push(n);
      }
      // else: drop the lower simultaneous note
    } else {
      out.push(n);
    }
  }
  return out.filter((n) => n.beats > 1e-3);
}

// ---- abstraction -------------------------------------------------------------

/** Continuous diatonic-degree index of a midi pitch within the detected key. */
function diatonicIndex(midi: number, key: DetectedKey): number {
  const scale = key.minor ? NATURAL_MINOR : MAJOR_SCALE;
  const rel = midi - (60 + key.tonicPc); // measure from tonic near middle C
  const octave = Math.floor(rel / 12);
  const pc = ((rel % 12) + 12) % 12;
  // nearest scale degree (chromatic notes snap to the closest diatonic step)
  let degree = 0;
  let bestDist = Infinity;
  for (let d = 0; d < scale.length; d++) {
    const dist = Math.abs(scale[d] - pc);
    if (dist < bestDist) {
      bestDist = dist;
      degree = d;
    }
  }
  return octave * scale.length + degree;
}

function quantizeBeats(beats: number): number {
  return Math.max(0.25, Math.round(beats * 4) / 4);
}

/** Convert one phrase's notes into PhraseCells relative to its anchor degree. */
function abstractPhrase(
  notes: RawNote[],
  key: DetectedKey,
  windowSteps: number,
): PhraseTemplate {
  const start = notes[0].beat;
  const anchor = diatonicIndex(notes[0].midi, key);
  const vels = [...notes.map((n) => n.velocity)].sort((a, b) => a - b);
  const medVel = vels[Math.floor(vels.length / 2)];

  const cells: PhraseCell[] = notes.map((n) => {
    const step = Math.max(0, Math.min(windowSteps - 1, Math.round((n.beat - start) * 4)));
    const onBeat = step % 4 === 0;
    const cell: PhraseCell = {
      rel: diatonicIndex(n.midi, key) - anchor,
      step,
      beats: quantizeBeats(n.beats),
      // squeeze real velocities into the library's gentle 0.05–0.1 range
      vel: Math.round((0.05 + n.velocity * 0.05) * 1000) / 1000,
    };
    if (onBeat && n.velocity >= medVel) cell.accent = true;
    if (cell.beats <= 0.25 && !onBeat) cell.pickup = true;
    return cell;
  });

  return { cells };
}

/**
 * Split a monophonic line into phrases. Breaks on rests >= 1 beat, when a
 * phrase outgrows the two-bar window, or when it hits `maxCells` notes — so
 * dense folk runs become several sparse, lofi-sized phrases instead of one
 * 25-note flurry.
 */
function segmentPhrases(notes: RawNote[], windowBeats: number, maxCells: number): RawNote[][] {
  const phrases: RawNote[][] = [];
  let current: RawNote[] = [];
  let phraseStart = notes.length ? notes[0].beat : 0;

  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    const prev = notes[i - 1];
    const restAfterPrev = prev ? n.beat - (prev.beat + prev.beats) : 0;
    const overWindow = n.beat - phraseStart >= windowBeats;
    const overCount = current.length >= maxCells;

    if (current.length && (restAfterPrev >= 1 || overWindow || overCount)) {
      phrases.push(current);
      current = [];
      phraseStart = n.beat;
    }
    current.push(n);
  }
  if (current.length) phrases.push(current);
  return phrases;
}

// ---- driver ------------------------------------------------------------------

interface Options {
  mood: string;
  bars: number;
  minNotes: number;
  maxCells: number;
  out?: string;
}

export interface MinedTunePackageJson {
  id: string;
  file: string;
  mood: string;
  key: string;
  confidence: number;
  score: number;
  structureHint: string;
  phrases: Record<"A" | "B" | "answer" | "tag", PhraseTemplate>;
  bassPhrase?: PhraseTemplate;
}

function mineFile(path: string, opts: Options): MinedTunePackageJson | null {
  const data = readFileSync(path);
  const midi = new Midi(data);
  const melody = skyline(pickMelodyTrack(midi));
  if (melody.length < opts.minNotes) return null;

  const histogram = new Array<number>(12).fill(0);
  for (const n of melody) histogram[((n.midi % 12) + 12) % 12] += n.beats;
  const key = detectKey(histogram);

  const ts = midi.header.timeSignatures[0]?.timeSignature ?? [4, 4];
  const beatsPerBar = (ts[0] * 4) / ts[1];
  const windowBeats = beatsPerBar * opts.bars;
  const windowSteps = Math.min(32, Math.round(windowBeats * 4));

  const segments = segmentPhrases(melody, windowBeats, opts.maxCells).filter(
    (p) => p.length >= opts.minNotes,
  );
  const templates = segments.map((seg) => abstractPhrase(seg, key, windowSteps));
  const labeled = labelTuneSections(templates);
  if (!labeled) return null;

  let bassPhrase: PhraseTemplate | undefined;
  const bassLine = pickBassTrack(midi);
  if (bassLine.length >= opts.minNotes) {
    const bassSeg = segmentPhrases(bassLine, windowBeats, opts.maxCells)[0];
    if (bassSeg?.length >= opts.minNotes) {
      bassPhrase = abstractPhrase(bassSeg, key, windowSteps);
    }
  }

  const base = path.replace(/\.(mid|midi)$/i, "").split(/[/\\]/).pop() ?? "tune";
  return {
    id: `${opts.mood}-${base}`,
    file: path,
    mood: opts.mood,
    key: `${PITCH_NAMES[key.tonicPc]} ${key.minor ? "minor" : "major"}`,
    confidence: Math.round(key.confidence * 1000) / 1000,
    score: labeled.score,
    structureHint: labeled.structureHint,
    phrases: labeled.phrases,
    bassPhrase,
  };
}

function collectMidiFiles(target: string): string[] {
  const st = statSync(target);
  if (st.isFile()) return [target];
  return readdirSync(target)
    .filter((f) => [".mid", ".midi"].includes(extname(f).toLowerCase()))
    .map((f) => join(target, f));
}

function parseArgs(argv: string[]): { target: string; opts: Options } {
  const opts: Options = { mood: "mellow", bars: 2, minNotes: 3, maxCells: 8 };
  let target = "";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mood") opts.mood = argv[++i];
    else if (a === "--bars") opts.bars = Number(argv[++i]);
    else if (a === "--min-notes") opts.minNotes = Number(argv[++i]);
    else if (a === "--max-cells") opts.maxCells = Number(argv[++i]);
    else if (a === "--out") opts.out = argv[++i];
    else if (!a.startsWith("--")) target = a;
  }
  if (!target) {
    throw new Error(
      "Usage: npx tsx scripts/mine-melodies.ts <file.mid | dir> [--mood m] [--bars n] [--min-notes n] [--max-cells n] [--out f.json]",
    );
  }
  return { target: resolve(target), opts };
}

function main() {
  const { target, opts } = parseArgs(process.argv.slice(2));
  const files = collectMidiFiles(target);
  const packages: MinedTunePackageJson[] = [];
  for (const file of files) {
    try {
      const result = mineFile(file, opts);
      if (result) packages.push(result);
      else console.error(`skip (incomplete tune package): ${file}`);
    } catch (err) {
      console.error(`error parsing ${file}:`, (err as Error).message);
    }
  }

  const payload = { packages };
  const json = JSON.stringify(payload, null, 2);
  if (opts.out) {
    writeFileSync(opts.out, json);
    console.error(`wrote ${packages.length} tune package(s) to ${opts.out}`);
  } else {
    process.stdout.write(`${json}\n`);
  }
}

main();
