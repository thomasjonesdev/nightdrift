"use client";

// The halo: play/stop button, scene progress ring, and — while the band
// plays — one concentric ring per active channel. Rings fade in when an
// instrument joins the lineup, fade out when it leaves, and glow gently
// brighter and dimmer with that channel's live level.

import { useEffect, useRef } from "react";
import type { ChannelId, ChannelLevels } from "@/lib/audio/engine";
import type { SceneLineup } from "@/lib/audio/scenes";

interface HaloButtonProps {
  playing: boolean;
  progress: number;
  lineup: SceneLineup | null;
  getLevels: () => ChannelLevels | null;
  /** Sleep-timer fraction left (1→0, null when no timer runs) — drawn as a ring. */
  timerProgress: number | null;
  onClick: () => void;
}

const SIZE = 290;
const VIEW_PAD = 10; // room for the progress playhead and its glow outside the ring
const STROKE = 1.5;
const R = (SIZE - STROKE) / 2;
const CX = SIZE / 2;
const CY = SIZE / 2;
const CIRC = 2 * Math.PI * R;

// outermost first: the weather outside the song, then the band, inward
const RINGS: { id: ChannelId; color: string }[] = [
  { id: "ambience", color: "#b9b2d8" }, // starlight
  { id: "chords", color: "#deaa68" },   // glow
  { id: "melody", color: "#efe6d2" },   // cream
  { id: "bass", color: "#b07a86" },     // dusk rose, warmed
  { id: "drums", color: "#a59fb4" },    // lavender
];
const RING_GAP = 9;
const RING_START = 14; // inset of the first instrument ring from the halo edge

// sleep timer: a ring between the progress ring and the band — same sweep as
// the scene ring, but unwinding counter-clockwise as time runs out
const TIMER_R = R - 7;
const TIMER_CIRC = 2 * Math.PI * TIMER_R;

function inLineup(id: ChannelId, lineup: SceneLineup): boolean {
  if (id === "bass") return lineup.bass !== "none";
  if (id === "ambience") return lineup.ambience !== "none";
  return true;
}

function playheadAt(p: number, r = R) {
  const angle = p * 2 * Math.PI - Math.PI / 2;
  return { x: CX + r * Math.cos(angle), y: CY + r * Math.sin(angle) };
}

export default function HaloButton({
  playing,
  progress,
  lineup,
  getLevels,
  timerProgress,
  onClick,
}: HaloButtonProps) {
  const elapsed = CIRC * progress;
  const head = playheadAt(progress);

  const ringEls = useRef(new Map<ChannelId, SVGCircleElement>());
  const timerArcEl = useRef<SVGCircleElement>(null);
  const timerDotEl = useRef<SVGCircleElement>(null);
  const timerPresence = useRef(0);
  const timerProgressRef = useRef(timerProgress);
  const lastTimerProgress = useRef(1);
  const ringState = useRef<Record<ChannelId, { presence: number; glow: number }>>({
    chords: { presence: 0, glow: 0 },
    melody: { presence: 0, glow: 0 },
    bass: { presence: 0, glow: 0 },
    drums: { presence: 0, glow: 0 },
    ambience: { presence: 0, glow: 0 },
  });
  const lineupRef = useRef(lineup);
  const playingRef = useRef(playing);

  useEffect(() => {
    lineupRef.current = lineup;
    playingRef.current = playing;
  }, [lineup, playing]);

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

      const levels = getLevels();
      for (const [id, el] of ringEls.current) {
        const s = ringState.current[id];
        const here =
          playingRef.current && lineupRef.current && inLineup(id, lineupRef.current) ? 1 : 0;
        // slow walk-on/walk-off as the lineup changes (~1s)
        s.presence += (here - s.presence) * 0.018;
        // gentle glow that swells and settles with the channel's level
        const target = levels?.[id] ?? 0;
        s.glow += (target - s.glow) * (target > s.glow ? 0.055 : 0.028);
        el.style.opacity = (s.presence * (0.07 + s.glow * 0.55)).toFixed(3);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [getLevels]);

  return (
    <button
      onClick={onClick}
      aria-label={playing ? "Stop the beat" : "Start the beat"}
      className={`relative flex size-[290px] cursor-pointer items-center justify-center overflow-visible rounded-full border bg-[radial-gradient(circle_at_50%_45%,rgba(214,160,96,0.10),transparent_70%)] transition-colors duration-[1200ms] focus-visible:outline-2 focus-visible:outline-offset-[6px] focus-visible:outline-ember ${
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
        {RINGS.map(({ id, color }, i) => (
          <circle
            key={id}
            ref={(el) => {
              if (el) ringEls.current.set(id, el);
              else ringEls.current.delete(id);
            }}
            cx={CX}
            cy={CY}
            r={R - RING_START - i * RING_GAP}
            fill="none"
            stroke={color}
            strokeWidth={1.25}
            style={{ opacity: 0, filter: `drop-shadow(0 0 5px ${color})` }}
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
        className={`absolute inset-[28%] rounded-full bg-[radial-gradient(circle_at_50%_40%,rgba(222,170,104,0.32),rgba(146,96,120,0.10)_60%,transparent_75%)] blur-[2px] transition-transform duration-[2000ms] ${
          playing ? "animate-breathe motion-reduce:animate-none" : "scale-[0.92]"
        }`}
      />
      <span
        className={`relative z-10 font-mono text-[13px] lowercase ${
          playing
            ? "text-ember/75 animate-breathe motion-reduce:animate-none"
            : "text-ember/60 transition-opacity duration-[1200ms]"
        }`}
        style={{
          filter: playing
            ? "drop-shadow(0 0 10px rgba(214, 160, 96, 0.22))"
            : "drop-shadow(0 0 12px rgba(214, 160, 96, 0.15))",
        }}
      >
        {playing ? "stop" : "begin"}
      </span>
    </button>
  );
}
