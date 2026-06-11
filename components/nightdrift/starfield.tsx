// fixed star positions so they don't jump on re-render
const STARS = Array.from({ length: 26 }, (_, i) => ({
  x: (i * 37 + 13) % 100,
  y: (i * 53 + 7) % 92,
  delay: (i % 9) * 1.3,
  size: i % 5 === 0 ? 3 : 2,
}));

export default function Starfield() {
  return (
    <div aria-hidden="true">
      {STARS.map((star, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-starlight animate-twinkle motion-reduce:animate-none motion-reduce:opacity-10"
          style={{
            left: `${star.x}%`,
            top: `${star.y}%`,
            animationDelay: `${star.delay}s`,
            width: star.size,
            height: star.size,
          }}
        />
      ))}
    </div>
  );
}
