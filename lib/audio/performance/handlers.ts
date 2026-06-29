// Per-instrument performance algorithms — idiosyncrasies of real players.

import { midiFromNote } from "../notes";
import type {
  NoteEvent,
  PerformanceContext,
  PerformanceHints,
  PerformanceRole,
  ShapedNote,
  VoiceLineState,
  VoicePerformanceState,
} from "./types";

function line(state: VoicePerformanceState, voiceId: string): VoiceLineState {
  let ln = state.voices.get(voiceId);
  if (!ln) {
    ln = {};
    state.voices.set(voiceId, ln);
  }
  return ln;
}

function shaped(
  e: NoteEvent,
  hints: PerformanceHints,
  partial?: Partial<NoteEvent>,
): ShapedNote {
  return {
    note: partial?.note ?? e.note,
    time: partial?.time ?? e.time,
    dur: partial?.dur ?? e.dur,
    vel: partial?.vel ?? e.vel,
    hints,
  };
}

function gap(st: VoiceLineState, time: number): number {
  if (st.lastEnd === undefined) return Infinity;
  return time - st.lastEnd;
}

function isLegato(st: VoiceLineState, time: number): boolean {
  return st.lastEnd !== undefined && time <= st.lastEnd + 0.025;
}

function interval(st: VoiceLineState, note: string): number {
  if (!st.lastNote) return 99;
  return Math.abs(midiFromNote(note) - midiFromNote(st.lastNote));
}

function commit(st: VoiceLineState, e: NoteEvent, dur: number) {
  st.lastNote = e.note;
  st.lastStart = e.time;
  st.lastEnd = e.time + dur;
}

function isLong(e: NoteEvent): boolean {
  return e.dur >= 1.8;
}

function isShort(e: NoteEvent): boolean {
  return e.dur < 0.55;
}

function shapeBassGuitar(e: NoteEvent, st: VoiceLineState): ShapedNote[] {
  const legato = isLegato(st, e.time);
  const step = interval(st, e.note);
  const samePitch = st.lastNote === e.note;
  let dur = e.dur;
  let vel = e.vel;
  let attack = 0.005;
  const hints: PerformanceHints = { naturalDecay: true };

  dur += 0.07 + (legato ? 0.05 : 0);
  if (step <= 3 && legato) {
    attack = 0.02;
    vel *= 0.9;
    hints.legato = true;
  } else if (samePitch && gap(st, e.time) < 0.35) {
    vel *= 0.72;
    attack = 0.003;
  } else if (legato) {
    attack = 0.016;
    vel *= 0.88;
    hints.legato = true;
  }

  st.hand = st.hand === 0 ? 1 : 0;
  hints.detuneCents = (st.hand === 0 ? -2 : 2) + (Math.random() - 0.5) * 3;
  hints.attackSec = attack;

  commit(st, e, dur);
  return [shaped(e, hints, { dur, vel })];
}

function shapePluckBass(e: NoteEvent, st: VoiceLineState): ShapedNote[] {
  const legato = isLegato(st, e.time);
  const dur = e.dur + (legato ? 0.04 : 0.02);
  const vel = e.vel * (legato ? 0.85 : 1);
  commit(st, e, dur);
  return [shaped(e, { attackSec: legato ? 0.012 : 0.008, naturalDecay: true }, { dur, vel })];
}

function shapeSineBass(e: NoteEvent, st: VoiceLineState): ShapedNote[] {
  const legato = isLegato(st, e.time);
  const dur = e.dur + 0.05;
  commit(st, e, dur);
  return [shaped(e, { attackSec: legato ? 0.025 : 0.018, legato, naturalDecay: true }, { dur })];
}

function shapePiano(e: NoteEvent, st: VoiceLineState, role: PerformanceRole): ShapedNote[] {
  const midi = midiFromNote(e.note);
  const legato = isLegato(st, e.time);
  const long = isLong(e);
  let vel = e.vel;
  let dur = e.dur;
  let attack = 0.004;

  if (long || role === "chord") {
    if (!st.pedalNotes) st.pedalNotes = new Set();
    st.pedalNotes.add(e.note);
    dur += 0.12;
    if (legato && st.lastNote === e.note) {
      vel *= 0.4;
      attack = 0.035;
    } else if (legato) {
      attack = 0.012;
      vel *= 0.92;
    }
    if (midi >= 72) vel *= 0.88;
    if (role === "melody") vel *= 1.1;
    commit(st, e, dur);
    return [shaped(e, { attackSec: attack, naturalDecay: true, legato }, { dur, vel })];
  }

  if (role === "melody") vel *= 1.08;

  if (isShort(e)) {
    attack = 0.002;
    dur = Math.min(dur, 1.4);
  }

  commit(st, e, dur);
  return [shaped(e, { attackSec: attack, naturalDecay: !isShort(e) }, { dur, vel })];
}

function shapeElectricKeys(e: NoteEvent, st: VoiceLineState, voiceId: string): ShapedNote[] {
  const legato = isLegato(st, e.time);
  let dur = e.dur;
  let vel = e.vel;
  let attack = voiceId === "clav" ? 0.001 : 0.008;

  if (isLong(e)) {
    dur += 0.08;
    if (legato) {
      attack = 0.02;
      vel *= 0.86;
    }
    commit(st, e, dur);
    return [shaped(e, { attackSec: attack, naturalDecay: true, legato }, { dur, vel })];
  }

  if (isShort(e)) {
    dur = Math.min(dur + 0.04, 1.2);
    vel *= 1.05;
  }

  commit(st, e, dur);
  return [shaped(e, { attackSec: attack }, { dur, vel })];
}

function shapeSustained(e: NoteEvent, st: VoiceLineState): ShapedNote[] {
  const same = st.lastNote === e.note;
  const overlapping = isLegato(st, e.time) && same;

  if (overlapping && e.vel < 0.15) {
    commit(st, e, e.dur);
    return [shaped(e, { attackSec: 0.12, legato: true, naturalDecay: true }, { vel: e.vel * 0.55 })];
  }

  if (overlapping && e.vel >= 0.15) {
    commit(st, e, Math.max(st.lastEnd ?? e.time, e.time + e.dur));
    return [];
  }

  const dur = e.dur + 0.15;
  commit(st, e, dur);
  return [shaped(e, { attackSec: 0.18, naturalDecay: true }, { dur })];
}

function shapePlucked(
  e: NoteEvent,
  st: VoiceLineState,
  opts: { ring?: boolean; soft?: boolean },
): ShapedNote[] {
  const legato = isLegato(st, e.time);
  const same = st.lastNote === e.note;
  let dur = e.dur;
  let vel = e.vel;
  let attack = 0.003;

  if (same && gap(st, e.time) < 0.22) {
    vel *= 0.65;
  }

  if (opts.ring || isLong(e)) {
    dur += 0.2;
    if (legato) attack = 0.01;
    commit(st, e, dur);
    return [shaped(e, { attackSec: attack, naturalDecay: true }, { dur, vel })];
  }

  if (opts.soft || isShort(e)) {
    vel *= 0.92;
    dur = Math.min(dur + 0.06, 1.8);
  }

  commit(st, e, dur);
  return [shaped(e, { attackSec: attack }, { dur, vel })];
}

function shapeGuitar(e: NoteEvent, st: VoiceLineState): ShapedNote[] {
  const legato = isLegato(st, e.time);
  let dur = e.dur + (legato ? 0.1 : 0.05);
  let vel = e.vel;
  if (legato && interval(st, e.note) <= 4) {
    vel *= 0.9;
  }
  commit(st, e, dur);
  return [shaped(e, { attackSec: legato ? 0.014 : 0.006, naturalDecay: true }, { dur, vel })];
}

function shapeHarp(e: NoteEvent, st: VoiceLineState): ShapedNote[] {
  return shapePlucked(e, st, { ring: true });
}

function shapeWind(e: NoteEvent, st: VoiceLineState, breathy: boolean): ShapedNote[] {
  const legato = isLegato(st, e.time);
  let dur = e.dur + (legato ? 0.06 : 0.03);
  let vel = e.vel;
  let attack = breathy ? 0.1 : 0.07;

  if (legato && interval(st, e.note) <= 2) {
    attack = 0.04;
    vel *= 0.9;
  }
  if (isShort(e)) attack = 0.05;

  commit(st, e, dur);
  return [shaped(e, { attackSec: attack, naturalDecay: isLong(e), legato }, { dur, vel })];
}

function shapeBell(e: NoteEvent, st: VoiceLineState): ShapedNote[] {
  if (st.lastNote === e.note && gap(st, e.time) < 0.5) {
    return [];
  }
  const dur = Math.max(e.dur, 2.2);
  commit(st, e, dur);
  return [shaped(e, { attackSec: 0.001, naturalDecay: true }, { dur, vel: e.vel * 0.95 })];
}

function shapeSynthLead(e: NoteEvent, st: VoiceLineState): ShapedNote[] {
  const legato = isLegato(st, e.time);
  const attack = legato ? 0.04 : 0.06;
  const dur = e.dur + (legato ? 0.05 : 0);
  commit(st, e, dur);
  return [shaped(e, { attackSec: attack, naturalDecay: isLong(e), legato }, { dur })];
}

function shapeDefault(e: NoteEvent, st: VoiceLineState): ShapedNote[] {
  commit(st, e, e.dur);
  return [shaped(e, {})];
}

type Handler = (e: NoteEvent, st: VoiceLineState, ctx: PerformanceContext) => ShapedNote[];

const HANDLERS: Record<string, Handler> = {
  bassGuitar: (e, st) => shapeBassGuitar(e, st),
  pluckBass: (e, st) => shapePluckBass(e, st),
  bass: (e, st) => shapeSineBass(e, st),
  pluck: (e, st, ctx) => shapePlucked(e, st, { soft: ctx.role === "melody" }),
  piano: (e, st, ctx) => shapePiano(e, st, ctx.role),
  ep: (e, st, ctx) => shapeElectricKeys(e, st, "ep"),
  fmep: (e, st, ctx) => shapeElectricKeys(e, st, "fmep"),
  wurli: (e, st, ctx) => shapeElectricKeys(e, st, "wurli"),
  clav: (e, st, ctx) => shapeElectricKeys(e, st, "clav"),
  organ: (e, st) => shapeSustained(e, st),
  strings: (e, st) => shapeSustained(e, st),
  choir: (e, st) => shapeSustained(e, st),
  accordion: (e, st) => shapeSustained(e, st),
  cello: (e, st) => shapeSustained(e, st),
  guitar: (e, st) => shapeGuitar(e, st),
  harp: (e, st) => shapeHarp(e, st),
  marimba: (e, st) => shapePlucked(e, st, {}),
  vibe: (e, st) => shapePlucked(e, st, { ring: true }),
  celeste: (e, st) => shapePlucked(e, st, { ring: true, soft: true }),
  flute: (e, st) => shapeWind(e, st, true),
  clarinet: (e, st) => shapeWind(e, st, true),
  oboe: (e, st) => shapeWind(e, st, true),
  horn: (e, st) => shapeWind(e, st, false),
  bell: (e, st) => shapeBell(e, st),
  synth: (e, st) => shapeSynthLead(e, st),
};

export function createPerformanceState(): VoicePerformanceState {
  return { voices: new Map() };
}

export function shapePerformance(
  voiceId: string,
  event: NoteEvent,
  state: VoicePerformanceState,
  ctx: PerformanceContext,
): ShapedNote[] {
  const st = line(state, voiceId);
  const handler = HANDLERS[voiceId] ?? shapeDefault;
  return handler(event, st, ctx).filter((n) => !n.hints.skip);
}

export function schedulePerformanceEnvelope(
  g: GainNode,
  time: number,
  peak: number,
  dur: number,
  hints: PerformanceHints,
  naturalLen?: number,
): number {
  const attack = hints.attackSec ?? 0.004;
  const release = hints.releaseSec ?? 0.06;
  let playLen = dur;

  if (hints.naturalDecay && naturalLen !== undefined) {
    playLen = naturalLen;
  } else if (hints.naturalDecay) {
    playLen = dur * 1.15;
  }

  const cutEarly = !hints.naturalDecay && naturalLen !== undefined && playLen < naturalLen * 0.9;

  g.gain.setValueAtTime(0.0001, time);
  g.gain.linearRampToValueAtTime(Math.max(0.0001, peak), time + attack);

  if (cutEarly) {
    const fadeStart = time + Math.max(attack, playLen - release);
    g.gain.setValueAtTime(peak, fadeStart);
    g.gain.exponentialRampToValueAtTime(0.0001, time + playLen);
  }

  return playLen;
}
