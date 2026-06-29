"use client";

import { useEffect, useRef } from "react";
import type { AmbienceBed } from "@/lib/audio/ambience";
import type { EnergyShape } from "@/lib/audio/scenes";
import { HALO_CLEAR_R } from "./halo-rings";

interface Star {
  ringIndex: number;
  angle: number;
  speed: number;
  size: number;
  twinklePhase: number;
}

const INNER_RING = 5;
const OUTER_RING = -8;
const RING_SPAN = INNER_RING - OUTER_RING;

const STARS: Star[] = Array.from({ length: 26 }, (_, i) => ({
  ringIndex: Math.floor((i * 14) / 26) - 8,
  angle: (i * 2.399963) % (2 * Math.PI),
  speed: 0.006 + (i % 6) * 0.003,
  size: i % 5 === 0 ? 3 : 2,
  twinklePhase: (i % 9) * 1.3,
}));

const FADE_IN_S = 2.4;
const TWINKLE_CYCLE_S = 9;
const EDGE_PAD = 10;

const AMBIENCE_PALETTE: Record<
  AmbienceBed,
  { core: string; glow: string; halo: string; speedMul: number; twinkleMul: number; opacityMul: number }
> = {
  none: {
    core: "rgba(185, 178, 216, 1)",
    glow: "rgba(185, 178, 216, 0.55)",
    halo: "rgba(185, 178, 216, 0.22)",
    speedMul: 1,
    twinkleMul: 1,
    opacityMul: 0.85,
  },
  rain: {
    core: "rgba(160, 190, 220, 1)",
    glow: "rgba(120, 160, 210, 0.5)",
    halo: "rgba(120, 160, 210, 0.22)",
    speedMul: 0.88,
    twinkleMul: 1.35,
    opacityMul: 1,
  },
  wind: {
    core: "rgba(175, 185, 210, 1)",
    glow: "rgba(150, 165, 200, 0.45)",
    halo: "rgba(150, 165, 200, 0.2)",
    speedMul: 1.22,
    twinkleMul: 0.95,
    opacityMul: 0.9,
  },
  city: {
    core: "rgba(200, 175, 150, 1)",
    glow: "rgba(180, 140, 110, 0.35)",
    halo: "rgba(180, 140, 110, 0.16)",
    speedMul: 0.72,
    twinkleMul: 0.75,
    opacityMul: 0.65,
  },
  fire: {
    core: "rgba(220, 175, 140, 1)",
    glow: "rgba(210, 130, 80, 0.45)",
    halo: "rgba(210, 130, 80, 0.2)",
    speedMul: 0.62,
    twinkleMul: 1.15,
    opacityMul: 0.8,
  },
};

function energySpeedMod(shape: EnergyShape | undefined, elapsed: number): number {
  switch (shape) {
    case "wave":
      return 0.82 + 0.18 * Math.sin(elapsed * 0.35);
    case "breathe":
      return 0.75 + 0.25 * (0.5 + 0.5 * Math.sin(elapsed * 0.28));
    case "plateau":
      return 1.05;
    case "arc":
      return 0.92 + 0.08 * Math.sin(elapsed * 0.2);
    default:
      return 1;
  }
}

function maxOrbitRadius(cx: number, cy: number, vw: number, vh: number): number {
  return Math.max(0, Math.min(cx, vw - cx, cy, vh - cy) - EDGE_PAD);
}

function starRingRadius(ringIndex: number, maxR: number): number {
  const minR = Math.min(HALO_CLEAR_R, maxR);
  const span = Math.max(0, maxR - minR);
  const t = (INNER_RING - ringIndex) / RING_SPAN;
  return minR + t * span;
}

interface StarfieldProps {
  center: { x: number; y: number } | null;
  energyShape?: EnergyShape;
  ambienceBed?: AmbienceBed;
  playing?: boolean;
}

export default function Starfield({
  center,
  energyShape,
  ambienceBed = "none",
  playing = false,
}: StarfieldProps) {
  const starRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const mountTime = useRef(0);
  const centerRef = useRef(center);
  const viewportRef = useRef({ w: 0, h: 0 });
  const reducedMotion = useRef(false);
  const dnaRef = useRef({ energyShape, ambienceBed, playing });

  useEffect(() => {
    centerRef.current = center;
  }, [center]);

  useEffect(() => {
    dnaRef.current = { energyShape, ambienceBed, playing };
  }, [energyShape, ambienceBed, playing]);

  useEffect(() => {
    mountTime.current = performance.now();
    reducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const syncViewport = () => {
      viewportRef.current = { w: window.innerWidth, h: window.innerHeight };
    };
    syncViewport();
    window.addEventListener("resize", syncViewport);

    let frame = 0;
    const tick = (now: number) => {
      const c = centerRef.current;
      const { w, h } = viewportRef.current;
      const { energyShape: shape, ambienceBed: bed, playing: live } = dnaRef.current;
      const palette = AMBIENCE_PALETTE[bed];
      const elapsed = (now - mountTime.current) / 1000;
      const fadeIn = Math.min(1, elapsed / FADE_IN_S);
      const liveMul = live ? 1 : 0.55;
      const maxR = c ? maxOrbitRadius(c.x, c.y, w, h) : 0;
      const speedMod = energySpeedMod(shape, elapsed) * palette.speedMul;

      STARS.forEach((star, i) => {
        const el = starRefs.current[i];
        if (!el) return;

        if (!c || maxR === 0) {
          el.style.opacity = "0";
          return;
        }

        const angle = reducedMotion.current
          ? star.angle
          : star.angle + star.speed * speedMod * elapsed;
        const r = starRingRadius(star.ringIndex, maxR);
        el.style.left = `${c.x + r * Math.cos(angle) - star.size / 2}px`;
        el.style.top = `${c.y + r * Math.sin(angle) - star.size / 2}px`;
        el.style.backgroundColor = palette.core;
        el.style.boxShadow = `0 0 3px ${palette.glow}, 0 0 7px ${palette.halo}`;

        const twinkleT = (elapsed + star.twinklePhase) / (TWINKLE_CYCLE_S / palette.twinkleMul);
        const twinkle = 0.07 + 0.21 * (0.5 + 0.5 * Math.sin(twinkleT * 2 * Math.PI));
        el.style.opacity = String(fadeIn * liveMul * twinkle * palette.opacityMul);
      });

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", syncViewport);
    };
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0">
      {STARS.map((star, i) => (
        <span
          key={i}
          ref={(el) => {
            starRefs.current[i] = el;
          }}
          className="absolute rounded-full bg-starlight motion-reduce:opacity-10"
          style={{
            width: star.size,
            height: star.size,
            opacity: 0,
          }}
        />
      ))}
    </div>
  );
}
