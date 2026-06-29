"use client";

import { useEffect, useState } from "react";
import type { EnergyShape } from "@/lib/audio/scenes";

interface DriftPresenceProps {
  show: boolean;
  children: React.ReactNode;
  className?: string;
  energyShape?: EnergyShape;
}

const EXIT_MS: Record<EnergyShape, number> = {
  arc: 2000,
  plateau: 2400,
  wave: 1700,
  breathe: 2200,
};

/** Keeps children mounted through drift-out so stop doesn't snap the readout away. */
export default function DriftPresence({
  show,
  children,
  className,
  energyShape = "arc",
}: DriftPresenceProps) {
  const [render, setRender] = useState(show);
  const [exiting, setExiting] = useState(false);
  const [content, setContent] = useState(children);

  useEffect(() => {
    if (show) {
      setContent(children);
      setRender(true);
      setExiting(false);
    }
  }, [show, children]);

  useEffect(() => {
    if (show || !render) return;
    setExiting(true);
    const exitMs = EXIT_MS[energyShape];
    const t = setTimeout(() => {
      setRender(false);
      setExiting(false);
    }, exitMs);
    return () => clearTimeout(t);
  }, [show, render, energyShape]);

  if (!render) return null;

  return (
    <div
      className={[exiting ? "animate-drift-out motion-reduce:animate-none" : "", className]
        .filter(Boolean)
        .join(" ")}
      style={exiting ? { animationDuration: `${EXIT_MS[energyShape]}ms` } : undefined}
    >
      {content}
    </div>
  );
}
