import { useGame } from '../hooks/useGame';
import { PlayerAvatar } from './PlayerAvatar';

// Opponents arranged in an arc around the table (md+), or a wrapping
// top row on small screens. Order is computed relative to my seat so
// turn order reads left-to-right from my perspective.
export function Opponents() {
  const { gameState, effects } = useGame();
  if (!gameState) return null;

  const myIndex = gameState.players.findIndex((p) => p.id === gameState.myPlayerId);
  const ordered = gameState.players
    .slice(myIndex + 1)
    .concat(gameState.players.slice(0, myIndex));

  const renderPlayer = (p: (typeof ordered)[number]) => (
    <PlayerAvatar
      key={p.id}
      player={p}
      isCurrentTurn={gameState.currentPlayerId === p.id}
      effect={effects[p.id]}
      size="sm"
    />
  );

  return (
    <>
      {/* small screens: wrapping row */}
      <div className="flex flex-wrap items-start justify-center gap-x-4 gap-y-2 px-2 pt-2 md:hidden">
        {ordered.map(renderPlayer)}
      </div>

      {/* md+: arc around the upper half of the table */}
      <div className="pointer-events-none absolute inset-0 hidden md:block">
        {ordered.map((p, i) => {
          const n = ordered.length;
          const theta = (Math.PI * (i + 1)) / (n + 1); // 0..π across the top
          const left = 50 + 44 * Math.cos(theta);
          const top = 50 - 44 * Math.sin(theta);
          return (
            <div
              key={p.id}
              className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${left}%`, top: `${top}%` }}
            >
              <PlayerAvatar
                player={p}
                isCurrentTurn={gameState.currentPlayerId === p.id}
                effect={effects[p.id]}
              />
            </div>
          );
        })}
      </div>
    </>
  );
}
