"use client";

// Full-screen vinyl grain. The noise tile is generated once on a canvas
// (no asset to load), tiled across the screen, and jittered by the
// noise-shift keyframes; opacity fades in and out with the crackle toggle.

import { useSyncExternalStore } from "react";

const TILE = 160;

let noiseTile: string | null = null;

function makeTile(): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const img = g.createImageData(TILE, TILE);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(Math.random() * 256);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

function subscribeTile(onChange: () => void) {
  if (noiseTile === null) {
    noiseTile = makeTile();
    onChange();
  }
  return () => {};
}

function useNoiseTile() {
  return useSyncExternalStore(subscribeTile, () => noiseTile, () => null);
}

export default function NoiseOverlay({ active }: { active: boolean }) {
  const tile = useNoiseTile();

  return (
    <div
      aria-hidden
      className="noise-overlay pointer-events-none fixed inset-0 z-40"
      style={{
        opacity: active && tile ? 0.035 : 0,
        backgroundImage: tile ? `url(${tile})` : undefined,
        backgroundSize: `${TILE}px ${TILE}px`,
      }}
    />
  );
}
