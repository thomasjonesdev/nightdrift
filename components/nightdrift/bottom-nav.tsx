"use client";

import { useState, useRef, useEffect } from "react";
import {
  IconSparkles,
  IconMoon,
  IconVolume2,
  IconVinyl,
  IconPlayerPlay,
  IconPlayerStop,
} from "@tabler/icons-react";
import { MOODS, TIMERS, type MoodKey } from "@/lib/audio/moods";
import Pill from "./pill";

type PanelKey = "mood" | "timer" | "volume" | "vinyl";

const NAV_ITEMS = [
  { key: "mood" as PanelKey, Icon: IconSparkles, label: "Mood" },
  { key: "timer" as PanelKey, Icon: IconMoon, label: "Sleep Timer" },
  { key: "volume" as PanelKey, Icon: IconVolume2, label: "Volume" },
  { key: "vinyl" as PanelKey, Icon: IconVinyl, label: "Vinyl" },
] as const;

interface BottomNavProps {
  mood: MoodKey;
  setMood: (m: MoodKey) => void;
  volumeDb: number;
  setVolumeDb: (v: number) => void;
  crackleOn: boolean;
  setCrackleOn: (v: boolean) => void;
  timerMin: number;
  setTimer: (m: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
}

function PanelHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3.5 font-sans text-[10px] uppercase tracking-[0.2em] text-haze-dim">
      {children}
    </div>
  );
}

function MoodPanel({
  mood,
  setMood,
}: {
  mood: MoodKey;
  setMood: (m: MoodKey) => void;
}) {
  return (
    <>
      <PanelHeader>Mood</PanelHeader>
      <div className="flex flex-wrap gap-2">
        {(Object.entries(MOODS) as [MoodKey, (typeof MOODS)[MoodKey]][]).map(
          ([key, m]) => (
            <Pill
              key={key}
              active={mood === key}
              onClick={() => setMood(key)}
              title={m.hint}
            >
              {m.label}
            </Pill>
          ),
        )}
      </div>
    </>
  );
}

function TimerPanel({
  timerMin,
  setTimer,
}: {
  timerMin: number;
  setTimer: (m: number) => void;
}) {
  return (
    <>
      <PanelHeader>Sleep Timer</PanelHeader>
      <div className="flex flex-wrap gap-2">
        {TIMERS.map((t) => (
          <Pill
            key={t.label}
            active={timerMin === t.min}
            onClick={() => setTimer(t.min)}
          >
            {t.label}
          </Pill>
        ))}
      </div>
    </>
  );
}

function VolumePanel({
  volumeDb,
  setVolumeDb,
}: {
  volumeDb: number;
  setVolumeDb: (v: number) => void;
}) {
  const pct = Math.round(((volumeDb - -30) / (-4 - -30)) * 100);
  return (
    <>
      <PanelHeader>Volume &middot; {pct}%</PanelHeader>
      <input
        type="range"
        min={-30}
        max={-4}
        step={1}
        value={volumeDb}
        onChange={(e) => setVolumeDb(Number(e.target.value))}
        className="volume-slider w-full"
        aria-label="Volume"
      />
    </>
  );
}

function VinylPanel({
  crackleOn,
  setCrackleOn,
}: {
  crackleOn: boolean;
  setCrackleOn: (v: boolean) => void;
}) {
  return (
    <>
      <PanelHeader>Vinyl Crackle</PanelHeader>
      <div className="flex gap-2">
        <Pill active={crackleOn} onClick={() => setCrackleOn(true)}>
          On
        </Pill>
        <Pill active={!crackleOn} onClick={() => setCrackleOn(false)}>
          Off
        </Pill>
      </div>
    </>
  );
}

function PlayStopButton({
  playing,
  onClick,
}: {
  playing: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={playing ? "Stop the beat" : "Start the beat"}
      className="relative mx-1 flex size-11 shrink-0 items-center justify-center rounded-full border border-ember/25 bg-[radial-gradient(circle_at_50%_35%,rgba(214,160,96,0.22),rgba(214,160,96,0.06)_70%)] shadow-[0_0_18px_rgba(214,160,96,0.14)] transition-[box-shadow,transform] duration-300 hover:shadow-[0_0_22px_rgba(214,160,96,0.22)] active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"
    >
      <IconPlayerPlay
        size={20}
        strokeWidth={1.75}
        className="absolute transition-all duration-500 ease-[cubic-bezier(0.34,1.4,0.64,1)] motion-reduce:transition-none"
        style={{
          color: "var(--color-ember)",
          opacity: playing ? 0 : 1,
          transform: playing ? "scale(0.55) rotate(-90deg)" : "scale(1) rotate(0deg)",
        }}
      />
      <IconPlayerStop
        size={20}
        strokeWidth={1.75}
        className="absolute transition-all duration-500 ease-[cubic-bezier(0.34,1.4,0.64,1)] motion-reduce:transition-none"
        style={{
          color: "var(--color-ember)",
          opacity: playing ? 1 : 0,
          transform: playing ? "scale(1) rotate(0deg)" : "scale(0.55) rotate(90deg)",
        }}
      />
    </button>
  );
}

function NavButton({
  active,
  label,
  onClick,
  Icon,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  Icon: typeof IconSparkles;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      data-active={active}
      className="glass-nav-btn group relative flex h-10 w-12 items-center justify-center rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"
    >
      <Icon
        size={21}
        strokeWidth={1.65}
        className="relative z-10 block transition-all duration-200"
        style={{
          color: active ? "var(--color-ember)" : "var(--color-haze-soft)",
          filter: active
            ? "drop-shadow(0 0 7px rgba(214,160,96,0.55))"
            : "none",
          transform: active ? "scale(1.08)" : "scale(1)",
        }}
      />
      <span
        className="absolute bottom-1.5 left-1/2 z-10 block h-[3px] w-[3px] -translate-x-1/2 rounded-full transition-all duration-200"
        style={{
          background: active ? "var(--color-ember)" : "transparent",
          boxShadow: active ? "0 0 5px rgba(214,160,96,0.7)" : "none",
        }}
      />
    </button>
  );
}

export default function BottomNav({
  mood,
  setMood,
  volumeDb,
  setVolumeDb,
  crackleOn,
  setCrackleOn,
  timerMin,
  setTimer,
  playing,
  onTogglePlay,
}: BottomNavProps) {
  const [activePanel, setActivePanel] = useState<PanelKey | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggle = (key: PanelKey) => {
    setActivePanel((prev) => (prev === key ? null : key));
  };

  // Close when tapping outside the container
  useEffect(() => {
    if (activePanel === null) return;
    function handleOutside(e: PointerEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setActivePanel(null);
      }
    }
    document.addEventListener("pointerdown", handleOutside);
    return () => document.removeEventListener("pointerdown", handleOutside);
  }, [activePanel]);

  const isOpen = activePanel !== null;

  return (
    <div
      ref={containerRef}
      className="fixed bottom-0 left-0 right-0 z-20 flex justify-center px-5"
      style={{ paddingBottom: "max(1.75rem, env(safe-area-inset-bottom))" }}
    >
      <div className="relative flex w-full max-w-[360px] flex-col items-center gap-2.5">
        {/* Floating panel — always in DOM, animated in/out */}
        <div
          className="w-full"
          style={{
            opacity: isOpen ? 1 : 0,
            transform: isOpen
              ? "translateY(0) scale(1)"
              : "translateY(14px) scale(0.96)",
            pointerEvents: isOpen ? "auto" : "none",
            transition:
              "opacity 280ms cubic-bezier(0.34,1.4,0.64,1), transform 280ms cubic-bezier(0.34,1.4,0.64,1)",
          }}
        >
          <div className="glass-panel w-full rounded-2xl p-5">
            {/* key forces the content to re-animate when switching panels */}
            <div key={activePanel} className="animate-drift-in motion-reduce:animate-none">
              {activePanel === "mood" && (
                <MoodPanel mood={mood} setMood={setMood} />
              )}
              {activePanel === "timer" && (
                <TimerPanel timerMin={timerMin} setTimer={setTimer} />
              )}
              {activePanel === "volume" && (
                <VolumePanel volumeDb={volumeDb} setVolumeDb={setVolumeDb} />
              )}
              {activePanel === "vinyl" && (
                <VinylPanel
                  crackleOn={crackleOn}
                  setCrackleOn={setCrackleOn}
                />
              )}
            </div>
          </div>
        </div>

        {/* Glass navbar pill */}
        <div className="glass-bar flex h-[62px] w-full items-center rounded-[26px] px-2">
          <div className="flex flex-1 items-center justify-around">
            {NAV_ITEMS.slice(0, 2).map(({ key, Icon, label }) => (
              <NavButton
                key={key}
                active={activePanel === key}
                label={label}
                Icon={Icon}
                onClick={() => toggle(key)}
              />
            ))}
          </div>
          <PlayStopButton playing={playing} onClick={onTogglePlay} />
          <div className="flex flex-1 items-center justify-around">
            {NAV_ITEMS.slice(2).map(({ key, Icon, label }) => (
              <NavButton
                key={key}
                active={activePanel === key}
                label={label}
                Icon={Icon}
                onClick={() => toggle(key)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
