import { useState } from 'react';
import type { Card } from '../shared/protocol';
import { isJumpInPlayable, isMyTurn, isPlayable, needsColorChoice, needsSwapTarget } from '../lib/rules';
import { useGame } from '../hooks/useGame';
import { CardView } from './CardView';
import { ColorPicker } from './ColorPicker';
import { SwapPicker } from './SwapPicker';

// My hand: fan layout, horizontally scrollable on overflow. Playable cards
// are raised and highlighted; wilds open the ColorPicker before playing.
// House rules: 7s open the SwapPicker (7-0 rule); with jump-in on, exact
// matches are tappable out of turn and fail quietly if someone was faster.
export function MyHand() {
  const { gameState, playCard, shakingCardId } = useGame();
  const [pendingWild, setPendingWild] = useState<Card | null>(null);
  const [pendingSeven, setPendingSeven] = useState<Card | null>(null);
  if (!gameState) return null;

  const myTurn = isMyTurn(gameState);
  const hand = gameState.myHand;
  const mid = (hand.length - 1) / 2;

  function handleCardClick(card: Card) {
    if (!gameState) return;
    if (isPlayable(card, gameState)) {
      if (needsColorChoice(card)) {
        setPendingWild(card);
      } else if (needsSwapTarget(card, gameState)) {
        setPendingSeven(card);
      } else {
        void playCard(card.id);
      }
      return;
    }
    // Jump-in: quiet mode — a lost race must not shake the card or toast.
    if (isJumpInPlayable(card, gameState)) {
      void playCard(card.id, undefined, undefined, { quiet: true });
    }
  }

  return (
    <div className="relative">
      {myTurn && (
        <p className="mb-1 text-center text-sm font-black text-yellow-300 animate-pulse">
          ✨ Your turn
        </p>
      )}
      <div className="hand-scroll overflow-x-auto px-4 pb-2 pt-6">
        <div className="flex w-max min-w-full justify-center">
          {hand.map((card, i) => {
            const playable = isPlayable(card, gameState);
            const jumpable = !playable && isJumpInPlayable(card, gameState);
            const rotation = (i - mid) * 4; // fan tilt
            return (
              <div
                key={card.id}
                data-card-id={card.id}
                className={[
                  i > 0 ? '-ml-6 sm:-ml-8' : '',
                  jumpable ? 'animate-pulse-glow rounded-2xl' : '',
                ].join(' ')}
                style={{ transform: `rotate(${rotation}deg)`, transformOrigin: 'bottom center' }}
              >
                <CardView
                  card={card}
                  size="md"
                  playable={playable || jumpable}
                  dimmed={!playable && !jumpable}
                  shaking={shakingCardId === card.id}
                  onClick={playable || jumpable ? () => handleCardClick(card) : undefined}
                />
              </div>
            );
          })}
          {hand.length === 0 && (
            <p className="py-6 text-white/50 text-sm">No cards</p>
          )}
        </div>
      </div>

      {pendingWild && (
        <ColorPicker
          onPick={(color) => {
            void playCard(pendingWild.id, color);
            setPendingWild(null);
          }}
          onCancel={() => setPendingWild(null)}
        />
      )}

      {pendingSeven && (
        <SwapPicker
          players={gameState.players.filter((p) => p.id !== gameState.myPlayerId)}
          onPick={(targetId) => {
            void playCard(pendingSeven.id, undefined, targetId);
            setPendingSeven(null);
          }}
          onCancel={() => setPendingSeven(null)}
        />
      )}
    </div>
  );
}
