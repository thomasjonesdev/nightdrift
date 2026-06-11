interface PillProps {
  active: boolean;
  onClick: () => void;
  title?: string;
  "aria-pressed"?: boolean;
  children: React.ReactNode;
}

export default function Pill({ active, children, ...rest }: PillProps) {
  return (
    <button
      className={`cursor-pointer rounded-full border px-4 py-[7px] font-sans text-[13px] tracking-[0.04em] transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember ${
        active
          ? "border-glow/70 bg-glow/10 text-cream"
          : "border-ink/20 text-lavender hover:border-glow/50 hover:text-parchment"
      }`}
      {...rest}
    >
      {children}
    </button>
  );
}
