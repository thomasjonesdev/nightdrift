"use client";

import { useEffect, useState } from "react";

interface DriftPresenceProps {
  show: boolean;
  children: React.ReactNode;
  className?: string;
}

const EXIT_MS = 2000;

/** Keeps children mounted through drift-out so stop doesn't snap the readout away. */
export default function DriftPresence({ show, children, className }: DriftPresenceProps) {
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
    const t = setTimeout(() => {
      setRender(false);
      setExiting(false);
    }, EXIT_MS);
    return () => clearTimeout(t);
  }, [show, render]);

  if (!render) return null;

  return (
    <div
      className={[exiting ? "animate-drift-out motion-reduce:animate-none" : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      {content}
    </div>
  );
}
