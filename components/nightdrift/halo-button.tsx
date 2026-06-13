"use client";

// The halo: scene progress ring, and — while the band plays — one concentric
// ring per active channel. Rings fade in when an instrument joins the lineup,
// fade out when it leaves, slide to new radii when the lineup changes, and
// glow gently with that channel's live level. Play/stop lives in the bottom nav.

import { useEffect, useRef } from "react";
import type { ChannelId, ChannelLevels } from "@/lib/audio/engine";
import type { SceneLineup } from "@/lib/audio/scenes";
import {
  HALO_R as R,
  HALO_SIZE as SIZE,
  HALO_STROKE as STROKE,
  ringRadius,
} from "./halo-rings";

interface HaloButtonProps {
  playing: boolean;
  progress: number;
  lineup: SceneLineup | null;
  getLevels: () => ChannelLevels | null;
  getKickPulse: () => number;
  /** Sleep-timer fraction left (1→0, null when no timer runs) — drawn as a ring. */
  timerProgress: number | null;
}

const VIEW_PAD = 10;
const CX = SIZE / 2;
const CY = SIZE / 2;
const CIRC = 2 * Math.PI * R;

/** Outermost → innermost — matches how the band reads visually. */
const CHANNEL_ORDER: ChannelId[] = ["ambience", "chords", "melody", "bass", "drums"];

const RING_META: Record<ChannelId, { color: string }> = {
  ambience: { color: "#b9b2d8" },
  chords: { color: "#deaa68" },
  melody: { color: "#efe6d2" },
  bass: { color: "#b07a86" },
  drums: { color: "#a59fb4" },
};

const TIMER_R = R - 7;
const TIMER_CIRC = 2 * Math.PI * TIMER_R;

function inLineup(id: ChannelId, lineup: SceneLineup): boolean {
  if (id === "bass") return lineup.bass !== "none";
  if (id === "ambience") return lineup.ambience !== "none";
  return true;
}

function activeChannels(lineup: SceneLineup): ChannelId[] {
  return CHANNEL_ORDER.filter((id) => inLineup(id, lineup));
}

function playheadAt(p: number, r = R) {
  const angle = p * 2 * Math.PI - Math.PI / 2;
  return { x: CX + r * Math.cos(angle), y: CY + r * Math.sin(angle) };
}

function kickPulseAt(intensity: number) {
  const t = Math.min(1, intensity);
  return {
    scale: 0.84 + t * 0.28,
    opacity: 0.68 + t * 0.32,
    glow: 6 + t * 18,
  };
}

function initRingState(): Record<ChannelId, { presence: number; glow: number; radius: number }> {
  return {
    ambience: { presence: 0, glow: 0, radius: ringRadius(0) },
    chords: { presence: 0, glow: 0, radius: ringRadius(1) },
    melody: { presence: 0, glow: 0, radius: ringRadius(2) },
    bass: { presence: 0, glow: 0, radius: ringRadius(3) },
    drums: { presence: 0, glow: 0, radius: ringRadius(4) },
  };
}

export default function HaloButton({
  playing,
  progress,
  lineup,
  getLevels,
  getKickPulse,
  timerProgress,
}: HaloButtonProps) {
  const elapsed = CIRC * progress;
  const head = playheadAt(progress);

  const ringEls = useRef(new Map<ChannelId, SVGCircleElement>());
  const breatheEl = useRef<HTMLSpanElement>(null);
  const timerArcEl = useRef<SVGCircleElement>(null);
  const timerDotEl = useRef<SVGCircleElement>(null);
  const timerPresence = useRef(0);
  const timerProgressRef = useRef(timerProgress);
  const lastTimerProgress = useRef(1);
  const ringState = useRef(initRingState());
  const lineupRef = useRef(lineup);
  const playingRef = useRef(playing);
  const kickGlow = useRef(0);
  const reducedMotion = useRef(false);
  const getLevelsRef = useRef(getLevels);
  const getKickPulseRef = useRef(getKickPulse);

  useEffect(() => {
    reducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    lineupRef.current = lineup;
    playingRef.current = playing;
  }, [lineup, playing]);

  useEffect(() => {
    getLevelsRef.current = getLevels;
    getKickPulseRef.current = getKickPulse;
  }, [getLevels, getKickPulse]);

  useEffect(() => {
    timerProgressRef.current = timerProgress;
    if (timerProgress !== null) lastTimerProgress.current = timerProgress;
  }, [timerProgress]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const timerTarget = timerProgressRef.current !== null ? 1 : 0;
      timerPresence.current += (timerTarget - timerPresence.current) * 0.018;

      const arc = timerArcEl.current;
      const dot = timerDotEl.current;
      if (arc && dot) {
        const p = Math.min(1, Math.max(0, timerProgressRef.current ?? lastTimerProgress.current));
        const timerHead = playheadAt(p, TIMER_R);
        arc.setAttribute("stroke-dasharray", `${TIMER_CIRC * p} ${TIMER_CIRC}`);
        dot.setAttribute("cx", String(timerHead.x));
        dot.setAttribute("cy", String(timerHead.y));
        const o = timerPresence.current.toFixed(3);
        arc.style.opacity = o;
        dot.style.opacity = o;
      }

      const levels = getLevelsRef.current();
      const active = lineupRef.current ? activeChannels(lineupRef.current) : [];

      for (const id of CHANNEL_ORDER) {
        const el = ringEls.current.get(id);
        if (!el) continue;

        const s = ringState.current[id];
        const slot = active.indexOf(id);
        const inBand = playingRef.current && slot >= 0;
        const targetPresence = inBand ? 1 : 0;
        const targetRadius = slot >= 0 ? ringRadius(slot) : s.radius;

        s.presence += (targetPresence - s.presence) * 0.018;
        s.radius += (targetRadius - s.radius) * (inBand ? 0.07 : 0.045);

        const target = inBand ? (levels?.[id] ?? 0) : 0;
        s.glow += (target - s.glow) * (target > s.glow ? 0.055 : 0.028);

        el.setAttribute("r", s.radius.toFixed(2));
        el.style.opacity = (s.presence * (0.07 + s.glow * 0.55)).toFixed(3);
      }

      const breathe = breatheEl.current;
      if (breathe) {
        if (playingRef.current && !reducedMotion.current) {
          const target = getKickPulseRef.current();
          kickGlow.current +=
            (target - kickGlow.current) * (target > kickGlow.current ? 0.72 : 0.16);
          const { scale, opacity, glow } = kickPulseAt(kickGlow.current);
          breathe.style.transform = `scale(${scale.toFixed(4)})`;
          breathe.style.opacity = opacity.toFixed(3);
          breathe.style.boxShadow = `0 0 ${glow.toFixed(1)}px rgba(222, 170, 104, ${(0.12 + kickGlow.current * 0.45).toFixed(3)})`;
        } else {
          kickGlow.current = 0;
          breathe.style.transform = "";
          breathe.style.opacity = "";
          breathe.style.boxShadow = "";
        }
      }

      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      aria-hidden
      className={`relative flex size-[290px] items-center justify-center overflow-visible rounded-full border bg-[radial-gradient(circle_at_50%_45%,rgba(214,160,96,0.10),transparent_70%)] transition-colors duration-[1200ms] ${
        playing ? "border-transparent" : "border-parchment/20"
      }`}
    >
      <svg
        className="pointer-events-none absolute"
        style={{
          left: -VIEW_PAD,
          top: -VIEW_PAD,
          width: SIZE + 2 * VIEW_PAD,
          height: SIZE + 2 * VIEW_PAD,
        }}
        viewBox={`${-VIEW_PAD} ${-VIEW_PAD} ${SIZE + 2 * VIEW_PAD} ${SIZE + 2 * VIEW_PAD}`}
        overflow="visible"
        aria-hidden
      >
        <circle
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          className={playing ? "text-parchment/15" : "text-parchment/20"}
        />
        {CHANNEL_ORDER.map((id) => (
          <circle
            key={id}
            ref={(el) => {
              if (el) ringEls.current.set(id, el);
              else ringEls.current.delete(id);
            }}
            cx={CX}
            cy={CY}
            r={ringRadius(CHANNEL_ORDER.indexOf(id))}
            fill="none"
            stroke={RING_META[id].color}
            strokeWidth={1.25}
            style={{ opacity: 0, filter: `drop-shadow(0 0 5px ${RING_META[id].color})` }}
          />
        ))}
        <circle
          ref={timerArcEl}
          cx={CX}
          cy={CY}
          r={TIMER_R}
          fill="none"
          stroke="#8d87a0"
          strokeOpacity={0.55}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeDasharray={`${TIMER_CIRC} ${TIMER_CIRC}`}
          transform={`rotate(-90 ${CX} ${CY})`}
          style={{ opacity: 0 }}
        />
        <circle
          ref={timerDotEl}
          cx={CX}
          cy={CY - TIMER_R}
          r={3.5}
          fill="#8d87a0"
          style={{ opacity: 0, filter: "drop-shadow(0 0 6px rgba(141, 135, 160, 0.75))" }}
        />
        {playing && (
          <>
            <circle
              cx={CX}
              cy={CY}
              r={R}
              fill="none"
              stroke="currentColor"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${elapsed} ${CIRC}`}
              transform={`rotate(-90 ${CX} ${CY})`}
              className="text-glow/50"
            />
            <circle
              cx={head.x}
              cy={head.y}
              r={3.5}
              fill="currentColor"
              className="text-glow"
              style={{ filter: "drop-shadow(0 0 6px rgba(222, 170, 104, 0.75))" }}
            />
          </>
        )}
      </svg>

      <span
        ref={breatheEl}
        className={`absolute inset-[28%] rounded-full bg-[radial-gradient(circle_at_50%_40%,rgba(222,170,104,0.32),rgba(146,96,120,0.10)_60%,transparent_75%)] blur-[2px] will-change-transform motion-reduce:scale-[0.92] ${
          playing ? "" : "scale-[0.92] transition-transform duration-[2000ms]"
        }`}
      />
    </div>
  );
}
