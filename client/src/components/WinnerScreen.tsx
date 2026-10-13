import { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { useGame } from '../hooks/useGame';

// Full-screen winner overlay with confetti. DOM effects (canvas-confetti)
// are isolated here so the rest of the app stays portable.
export function WinnerScreen() {
  const { gameOver, gameState, leaveAndReset } = useGame();

  const isMe = gameOver && gameState && gameOver.winnerId === gameState.myPlayerId;

  useEffect(() => {
    if (!gameOver) return;
    const end = Date.now() + 2500;
    let raf = 0;
    const frame = () => {
      confetti({
        particleCount: 6,
        angle: 60,
        spread: 60,
        origin: { x: 0, y: 0.7 },
        zIndex: 100,
      });
      confetti({
        particleCount: 6,
        angle: 120,
        spread: 60,
        origin: { x: 1, y: 0.7 },
        zIndex: 100,
      });
      if (Date.now() < end) raf = requestAnimationFrame(frame);
    };
    confetti({ particleCount: 180, spread: 100, origin: { y: 0.6 }, zIndex: 100 });
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [gameOver]);

  if (!gameOver) return null;

  const winner = gameState?.players.find((p) => p.id === gameOver.winnerId);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6">
      <div className="animate-pop w-full max-w-sm rounded-3xl bg-neutral-900/95 border border-yellow-300/30 p-8 text-center shadow-2xl">
        <div className="mb-2 text-6xl">{winner?.avatar ?? '🏆'}</div>
        <p className="text-sm font-bold uppercase tracking-widest text-yellow-300">
          {isMe ? '🎉 You win! 🎉' : 'Winner'}
        </p>
        <h2 className="mb-6 mt-1 text-4xl font-black">{gameOver.winnerName}</h2>
        <button
          type="button"
          onClick={() => void leaveAndReset()}
          className="w-full rounded-2xl bg-gradient-to-b from-yellow-400 to-amber-500 py-3.5 text-lg font-black text-neutral-900 shadow-lg transition active:scale-95"
        >
          Back to Lobby
        </button>
      </div>
    </div>
  );
}
