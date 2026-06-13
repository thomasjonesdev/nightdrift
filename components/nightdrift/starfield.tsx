"use client";

import { useEffect, useRef } from "react";
import { HALO_CLEAR_R } from "./halo-rings";

interface Star {
  ringIndex: number;
  angle: number;
  speed: number;
  size: number;
  twinklePhase: number;
}

// ring indices -8…5 — inner to outer layers, radii mapped to viewport below
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

/** Furthest orbit from center to the nearest viewport edge. */
function maxOrbitRadius(cx: number, cy: number, vw: number, vh: number): number {
  return Math.max(0, Math.min(cx, vw - cx, cy, vh - cy) - EDGE_PAD);
}

/** Map a ring layer to a radius from just outside the halo out to the viewport edge. */
function starRingRadius(ringIndex: number, maxR: number): number {
  const minR = Math.min(HALO_CLEAR_R, maxR);
  const span = Math.max(0, maxR - minR);
  const t = (INNER_RING - ringIndex) / RING_SPAN;
  return minR + t * span;
}

interface StarfieldProps {
  center: { x: number; y: number } | null;
}

export default function Starfield({ center }: StarfieldProps) {
  const starRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const mountTime = useRef(0);
  const centerRef = useRef(center);
  const viewportRef = useRef({ w: 0, h: 0 });
  const reducedMotion = useRef(false);

  useEffect(() => {
    centerRef.current = center;
  }, [center]);

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
      const elapsed = (now - mountTime.current) / 1000;
      const fadeIn = Math.min(1, elapsed / FADE_IN_S);
      const maxR = c ? maxOrbitRadius(c.x, c.y, w, h) : 0;

      STARS.forEach((star, i) => {
        const el = starRefs.current[i];
        if (!el) return;

        if (!c || maxR === 0) {
          el.style.opacity = "0";
          return;
        }

        const angle = reducedMotion.current ? star.angle : star.angle + star.speed * elapsed;
        const r = starRingRadius(star.ringIndex, maxR);
        el.style.left = `${c.x + r * Math.cos(angle) - star.size / 2}px`;
        el.style.top = `${c.y + r * Math.sin(angle) - star.size / 2}px`;

        const twinkleT = (elapsed + star.twinklePhase) / TWINKLE_CYCLE_S;
        const twinkle = 0.07 + 0.21 * (0.5 + 0.5 * Math.sin(twinkleT * 2 * Math.PI));
        el.style.opacity = String(fadeIn * twinkle);
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
            boxShadow:
              "0 0 3px rgba(185, 178, 216, 0.55), 0 0 7px rgba(185, 178, 216, 0.22)",
          }}
        />
      ))}
    </div>
  );
}
