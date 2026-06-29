"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createEngine, type ChannelLevels, type NightdriftEngine } from "@/lib/audio/engine";
import {
  bindMediaSession,
  clearMediaSession,
  updateMediaSession,
} from "@/lib/audio/media-session";
import type { MoodKey } from "@/lib/audio/moods";
import { parseSeed } from "@/lib/audio/random";
import { PlaybackSink } from "@/lib/audio/playback-sink";
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
  /** Sleep-timer fraction left (1→0), for the halo countdown ring. */
  timerProgress: number | null;
  /** The generated "track" currently drifting by, for the now-playing readout. */
  scene: SceneSummary | null;
  /** Elapsed fraction of the current scene (0–1), for the halo progress ring. */
  sceneProgress: number;
  /**
   * Live per-channel output levels (0–1), polled by the band stage on its
   * own rAF loop — a function (not state) so 60fps reads skip React renders.
   */
  getChannelLevels: () => ChannelLevels | null;
  /** Kick-hit envelope (0–1) for the halo center pulse. */
  getKickPulse: () => number;
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
  const [timerProgress, setTimerProgress] = useState<number | null>(null);
  const [scene, setScene] = useState<SceneSummary | null>(null);
  const [sceneProgress, setSceneProgress] = useState(0);

  const engine = useRef<NightdriftEngine | null>(null);
  const sink = useRef<PlaybackSink | null>(null);
  const moodRef = useRef(mood);
  const crackleRef = useRef(crackleOn);
  const volRef = useRef(volumeDb);
  const timerEnd = useRef<number | null>(null);
  const timerTotalSecs = useRef(0);
  const fading = useRef(false);
  const startRef = useRef<() => void>(() => {});
  const stopRef = useRef<(fadeSeconds?: number) => void>(() => {});

  // mirrored into refs so start() always reads fresh values
  useEffect(() => {
    moodRef.current = mood;
    crackleRef.current = crackleOn;
    volRef.current = volumeDb;
  }, [mood, crackleOn, volumeDb]);

  // read shareable session params on first load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const moodParam = params.get("mood");
    if (moodParam === "mellow" || moodParam === "jazzy" || moodParam === "rainy") {
      setMoodState(moodParam);
      moodRef.current = moodParam;
    }
  }, []);

  const start = useCallback(() => {
    if (engine.current) engine.current.dispose();
    const seed =
      typeof window !== "undefined"
        ? parseSeed(new URLSearchParams(window.location.search).get("seed"))
        : undefined;
    engine.current = createEngine({
      mood: moodRef.current,
      crackle: crackleRef.current,
      seed,
      onSceneChange: setScene,
    });
    if (engine.current.ctx.state === "suspended") void engine.current.ctx.resume();
    engine.current.start(volRef.current);

    if (!sink.current) sink.current = new PlaybackSink();
    void sink.current.attach(engine.current.playbackStream).catch(() => {
      engine.current?.connectDirectOutput();
    });

    fading.current = false;

    if (timerMin > 0) {
      timerTotalSecs.current = timerMin * 60;
      timerEnd.current = Date.now() + timerTotalSecs.current * 1000;
      setRemaining(timerTotalSecs.current);
      setTimerProgress(1);
    } else {
      timerEnd.current = null;
      timerTotalSecs.current = 0;
      setRemaining(null);
      setTimerProgress(null);
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
        sink.current?.detach();
      }, fadeSeconds * 1000 + 200);
    }
    timerEnd.current = null;
    timerTotalSecs.current = 0;
    fading.current = false;
    setRemaining(null);
    setTimerProgress(null);
    setPlaying(false);
    setSceneProgress(0);
    clearMediaSession();
  }, []);

  useEffect(() => {
    startRef.current = start;
    stopRef.current = stop;
  }, [start, stop]);

  const getChannelLevels = useCallback(
    () => engine.current?.getChannelLevels() ?? null,
    [],
  );

  const getKickPulse = useCallback(
    () => engine.current?.getKickPulse() ?? 0,
    [],
  );

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
        timerTotalSecs.current = min * 60;
        timerEnd.current = Date.now() + timerTotalSecs.current * 1000;
        setRemaining(timerTotalSecs.current);
        setTimerProgress(1);
        fading.current = false;
        engine.current?.setVolume(volRef.current, 1);
      } else {
        timerEnd.current = null;
        timerTotalSecs.current = 0;
        setRemaining(null);
        setTimerProgress(null);
      }
    },
    [playing],
  );

  // lock-screen / headset controls → same start/stop as the halo button
  useEffect(() => {
    return bindMediaSession({
      onPlay: () => startRef.current(),
      onPause: () => stopRef.current(),
    });
  }, []);

  // now-playing metadata for the OS media UI
  useEffect(() => {
    if (playing) updateMediaSession(scene);
  }, [playing, scene]);

  // halo rings: smooth scene progress + sleep-timer countdown
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      setSceneProgress(engine.current?.getSceneProgress() ?? 0);
      if (timerEnd.current && timerTotalSecs.current > 0) {
        const leftMs = Math.max(0, timerEnd.current - Date.now());
        setTimerProgress(leftMs / (timerTotalSecs.current * 1000));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

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
      sink.current?.dispose();
      sink.current = null;
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
    timerProgress,
    scene,
    sceneProgress,
    getChannelLevels,
    getKickPulse,
    start,
    stop,
  };
}
