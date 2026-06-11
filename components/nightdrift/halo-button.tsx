interface HaloButtonProps {
  playing: boolean;
  onClick: () => void;
}

export default function HaloButton({ playing, onClick }: HaloButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-label={playing ? "Stop the beat" : "Start the beat"}
      className={`relative flex size-[230px] cursor-pointer items-center justify-center rounded-full border bg-[radial-gradient(circle_at_50%_45%,rgba(214,160,96,0.10),transparent_70%)] transition-colors duration-[1200ms] focus-visible:outline-2 focus-visible:outline-offset-[6px] focus-visible:outline-ember ${
        playing ? "border-glow/45" : "border-parchment/20"
      }`}
    >
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
