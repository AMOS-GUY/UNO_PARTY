import confetti from 'canvas-confetti';

// Celebration effects live here so the rest of the app stays DOM-free.
// fireFinish: single burst when I finish; firePodium: sustained rain at game end.

export function fireFinish(): void {
  confetti({ particleCount: 160, spread: 100, origin: { y: 0.6 }, zIndex: 100 });
}

export function firePodium(durationMs = 2500): () => void {
  const end = Date.now() + durationMs;
  let raf = 0;
  const frame = () => {
    confetti({ particleCount: 6, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, zIndex: 100 });
    confetti({ particleCount: 6, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, zIndex: 100 });
    if (Date.now() < end) raf = requestAnimationFrame(frame);
  };
  fireFinish();
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
