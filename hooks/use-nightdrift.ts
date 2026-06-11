"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createEngine, type NightdriftEngine } from "@/lib/audio/engine";
import type { MoodKey } from "@/lib/audio/moods";
import type { SceneSummary } from "@/lib/audio/scenes";

const DEFAULT_VOLUME_DB = -12;
const STOP_FADE_SECS = 1.5;

export interface Nightdrift {
  playing: boolean;
  mood: MoodKey;
  setMood: (mood: MoodKey) => void;
  volumeDb: number;
  setVolumeDb: (db: number) => void;
  crackleOn: boolean;
  setCrackleOn: (on: boolean) => void;
  timerMin: number;
  setTimer: (min: number) => void;
  /** Seconds until the sleep timer stops playback, or null when no timer runs. */
  remaining: number | null;
  /** The generated "track" currently drifting by, for the now-playing readout. */
  scene: SceneSummary | null;
  start: () => void;
  stop: () => void;
}

export function useNightdrift(): Nightdrift {
  const [playing, setPlaying] = useState(false);
  const [mood, setMoodState] = useState<MoodKey>("mellow");
  const [volumeDb, setVolumeDb] = useState(DEFAULT_VOLUME_DB);
  const [crackleOn, setCrackleOnState] = useState(true);
  const [timerMin, setTimerMin] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [scene, setScene] = useState<SceneSummary | null>(null);

  const engine = useRef<NightdriftEngine | null>(null);
  const moodRef = useRef(mood);
  const crackleRef = useRef(crackleOn);
  const volRef = useRef(volumeDb);
  const timerEnd = useRef<number | null>(null);
  const fading = useRef(false);

  // mirrored into refs so start() always reads fresh values
  useEffect(() => {
    moodRef.current = mood;
    crackleRef.current = crackleOn;
    volRef.current = volumeDb;
  }, [mood, crackleOn, volumeDb]);

  const start = useCallback(() => {
    if (engine.current) engine.current.dispose();
    engine.current = createEngine({
      mood: moodRef.current,
      crackle: crackleRef.current,
      onSceneChange: setScene,
    });
    if (engine.current.ctx.state === "suspended") engine.current.ctx.resume();
    engine.current.start(volRef.current);
    fading.current = false;

    if (timerMin > 0) {
      timerEnd.current = Date.now() + timerMin * 60 * 1000;
      setRemaining(timerMin * 60);
    } else {
      timerEnd.current = null;
      setRemaining(null);
    }
    setPlaying(true);
  }, [timerMin]);

  const stop = useCallback((fadeSeconds = STOP_FADE_SECS) => {
    const e = engine.current;
    if (e) {
      e.fadeOut(fadeSeconds);
      setTimeout(() => {
        if (engine.current === e) {
          e.dispose();
          engine.current = null;
        }
      }, fadeSeconds * 1000 + 200);
    }
    timerEnd.current = null;
    fading.current = false;
    setRemaining(null);
    setPlaying(false);
  }, []);

  const setMood = useCallback((next: MoodKey) => {
    setMoodState(next);
    engine.current?.setMood(next);
  }, []);

  const setCrackleOn = useCallback((on: boolean) => {
    setCrackleOnState(on);
    engine.current?.setCrackle(on);
  }, []);

  const setTimer = useCallback(
    (min: number) => {
      setTimerMin(min);
      if (!playing) return;
      if (min > 0) {
        timerEnd.current = Date.now() + min * 60 * 1000;
        setRemaining(min * 60);
        fading.current = false;
        engine.current?.setVolume(volRef.current, 1);
      } else {
        timerEnd.current = null;
        setRemaining(null);
      }
    },
    [playing],
  );

  // sleep timer: tick + long fade over the final minute
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      if (!timerEnd.current) return;
      const left = Math.max(0, Math.round((timerEnd.current - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 60 && !fading.current && engine.current) {
        fading.current = true;
        engine.current.fadeOut(Math.max(left, 5));
      }
      if (left <= 0) stop(0.5);
    }, 1000);
    return () => clearInterval(id);
  }, [playing, stop]);

  // live volume (unless the goodnight fade has begun)
  useEffect(() => {
    if (playing && engine.current && !fading.current) {
      engine.current.setVolume(volumeDb);
    }
  }, [volumeDb, playing]);

  // teardown
  useEffect(() => {
    return () => {
      if (engine.current) engine.current.dispose();
    };
  }, []);

  return {
    playing,
    mood,
    setMood,
    volumeDb,
    setVolumeDb,
    crackleOn,
    setCrackleOn,
    timerMin,
    setTimer,
    remaining,
    scene,
    start,
    stop,
  };
}
