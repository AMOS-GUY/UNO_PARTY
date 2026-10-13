import { useEffect } from 'react';
import { api } from '../lib/socket';
import { firePodium } from '../lib/celebrate';
import { useGame } from '../hooks/useGame';

const MEDALS = ['🥇', '🥈', '🥉'];

// End-of-game podium: full ranking by finish place, last place marked 💀.
// The host gets Play Again (room resets to lobby, same seats); everyone
// gets Back to Lobby.
export function WinnerScreen() {
  const { gameOver, gameState, leaveAndReset, pushToast } = useGame();

  useEffect(() => {
    if (!gameOver) return;
    return firePodium(2500);
  }, [gameOver]);

  if (!gameOver) return null;

  const isHost = gameState?.hostId === gameState?.myPlayerId;
  const placements = [...gameOver.placements].sort((a, b) => a.place - b.place);
  const lastPlace = placements.length > 0 ? placements[placements.length - 1]!.place : 0;

  async function handlePlayAgain() {
    const res = await api.playAgain();
    if (!res.ok) pushToast('error', res.error);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6">
      <div className="animate-pop w-full max-w-sm rounded-3xl bg-neutral-900/95 border border-yellow-300/30 p-8 text-center shadow-2xl">
        <h2 className="mb-4 text-3xl font-black">🏁 Final Standings</h2>
        <ol className="mb-6 space-y-2">
          {placements.map((p) => {
            const avatar = gameState?.players.find((pl) => pl.id === p.playerId)?.avatar;
            const isMe = p.playerId === gameState?.myPlayerId;
            const isLast = p.place === lastPlace && placements.length > 1;
            return (
              <li
                key={p.playerId}
                className={[
                  'flex items-center gap-3 rounded-2xl border px-4 py-2.5',
                  p.place === 1
                    ? 'border-yellow-300/50 bg-yellow-300/10'
                    : 'border-white/10 bg-white/5',
                ].join(' ')}
              >
                <span className="w-8 text-2xl">
                  {isLast ? '💀' : (MEDALS[p.place - 1] ?? `#${p.place}`)}
                </span>
                <span className="text-xl">{avatar}</span>
                <span className="flex-1 truncate text-left font-bold">
                  {p.name}
                  {isMe && <span className="ml-1 text-xs text-yellow-300">(you)</span>}
                </span>
                <span className="text-xs font-semibold text-white/50">
                  {isLast ? 'Last' : `#${p.place}`}
                </span>
              </li>
            );
          })}
        </ol>
        {isHost && (
          <button
            type="button"
            onClick={() => void handlePlayAgain()}
            className="mb-3 w-full rounded-2xl bg-gradient-to-b from-green-500 to-green-700 py-3.5 text-lg font-black shadow-lg transition active:scale-95"
          >
            🔁 Play Again
          </button>
        )}
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
