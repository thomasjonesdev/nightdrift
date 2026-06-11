interface HaloButtonProps {
  playing: boolean;
  progress: number;
  onClick: () => void;
}

const SIZE = 230;
const STROKE = 1.5;
const R = (SIZE - STROKE) / 2;
const CX = SIZE / 2;
const CY = SIZE / 2;
const CIRC = 2 * Math.PI * R;

function playheadAt(p: number) {
  const angle = p * 2 * Math.PI - Math.PI / 2;
  return { x: CX + R * Math.cos(angle), y: CY + R * Math.sin(angle) };
}

export default function HaloButton({ playing, progress, onClick }: HaloButtonProps) {
  const elapsed = CIRC * progress;
  const head = playheadAt(progress);

  return (
    <button
      onClick={onClick}
      aria-label={playing ? "Stop the beat" : "Start the beat"}
      className={`relative flex size-[230px] cursor-pointer items-center justify-center rounded-full border bg-[radial-gradient(circle_at_50%_45%,rgba(214,160,96,0.10),transparent_70%)] transition-colors duration-[1200ms] focus-visible:outline-2 focus-visible:outline-offset-[6px] focus-visible:outline-ember ${
        playing ? "border-transparent" : "border-parchment/20"
      }`}
    >
      <svg
        className="pointer-events-none absolute inset-0"
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
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
        className={`absolute inset-[24%] rounded-full bg-[radial-gradient(circle_at_50%_40%,rgba(222,170,104,0.32),rgba(146,96,120,0.10)_60%,transparent_75%)] blur-[2px] transition-transform duration-[2000ms] ${
          playing ? "animate-breathe motion-reduce:animate-none" : "scale-[0.92]"
        }`}
      />
      <span className="relative z-10 font-sans text-[13px] lowercase tracking-[0.18em] text-cream">
        {playing ? "playing — tap to stop" : "begin"}
      </span>
    </button>
  );
}
