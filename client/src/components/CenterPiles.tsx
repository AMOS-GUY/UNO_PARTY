import type { CSSProperties } from 'react';
import { api } from '../lib/socket';
import { isMyTurn } from '../lib/rules';
import { useGame } from '../hooks/useGame';
import { CardBack, CardView, COLOR_HEX } from './CardView';

// Center of the table: draw pile, discard pile, active color indicator,
// draw-stack warning, direction indicator, and transient animations.
export function CenterPiles() {
  const { gameState, pushToast, flyingCard, drawnPulse } = useGame();
  if (!gameState) return null;

  const myTurn = isMyTurn(gameState);
  const activeColor = gameState.activeColor ?? undefined;

  async function handleDraw() {
    const res = await api.drawCard();
    if (!res.ok) pushToast('error', res.error);
  }

  return (
    <div className="relative flex items-center justify-center gap-6 sm:gap-10 py-2">
      {/* draw pile */}
      <div className="relative flex flex-col items-center gap-1" data-draw-pile>
        <CardBack
          size="md"
          onClick={myTurn ? handleDraw : undefined}
          className={myTurn ? 'ring-2 ring-yellow-300/60' : ''}
        />
        {drawnPulse && (
          <span
            key={drawnPulse.id}
            className="absolute inset-0 rounded-2xl border-4 border-yellow-300 animate-ping pointer-events-none"
          />
        )}
        <span className="text-[0.65rem] font-semibold text-white/70 text-center leading-tight">
          {gameState.deckCount} deck{gameState.deckCount > 1 ? 's' : ''} · {gameState.drawPileCount} left
        </span>
      </div>

      {/* discard pile */}
      <div className="relative flex flex-col items-center gap-1" data-discard-pile>
        <div
          className="rounded-[1.1rem] p-1 transition-shadow"
          style={
            activeColor
              ? { boxShadow: `0 0 0 4px ${COLOR_HEX[activeColor]}, 0 0 24px 4px ${COLOR_HEX[activeColor]}66` }
              : undefined
          }
        >
          {gameState.topCard ? (
            <CardView card={gameState.topCard} size="md" />
          ) : (
            <div className="w-16 h-24 rounded-2xl border-2 border-dashed border-white/25" />
          )}
        </div>
        <span className="flex items-center gap-1 text-[0.65rem] font-semibold text-white/70">
          {activeColor && (
            <span
              className="inline-block h-3 w-3 rounded-full border border-white/60"
              style={{ backgroundColor: COLOR_HEX[activeColor] }}
            />
          )}
          {activeColor ?? '—'}
        </span>

        {/* direction indicator */}
        <span
          className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-white/40 text-sm select-none"
          title={gameState.direction === 1 ? 'Clockwise' : 'Counter-clockwise'}
        >
          {gameState.direction === 1 ? '↻' : '↺'}
        </span>
      </div>

      {/* draw stack warning */}
      {gameState.drawStack && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 animate-pop whitespace-nowrap rounded-full bg-red-600 px-3 py-1 text-xs font-black shadow-lg border border-red-300/50">
          +{gameState.drawStack.amount} stack! Play a {gameState.drawStack.kind === 'draw2' ? '+2' : '+4'} or draw
        </div>
      )}

      {/* cardPlayed fly animation (decorative; slides toward the discard pile) */}
      {flyingCard && (
        <div
          key={flyingCard.id}
          className="pointer-events-none absolute left-1/2 top-1/2 z-30 animate-slide-to-discard"
          style={
            {
              '--sx': '-50%',
              '--sy': '40vh',
              '--tx': '-50%',
              '--ty': '0px',
              '--sr': '0deg',
              '--tr': '10deg',
            } as CSSProperties
          }
        >
          <CardView card={flyingCard.event.card} size="sm" />
        </div>
      )}
    </div>
  );
}
