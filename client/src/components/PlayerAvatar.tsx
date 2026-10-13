import type { PlayerPublic } from '../shared/protocol';
import type { EmojiEffect } from '../hooks/useGame';

interface PlayerAvatarProps {
  player: PlayerPublic;
  isCurrentTurn: boolean;
  effect?: EmojiEffect;
  size?: 'sm' | 'md';
  cardCountBadge?: boolean;
}

export function PlayerAvatar({
  player,
  isCurrentTurn,
  effect,
  size = 'md',
  cardCountBadge = true,
}: PlayerAvatarProps) {
  const dim = !player.connected;
  const avatarSize = size === 'sm' ? 'w-10 h-10 text-xl' : 'w-14 h-14 text-3xl';

  return (
    <div className={`relative flex flex-col items-center gap-1 ${dim ? 'opacity-40 grayscale' : ''}`}>
      <div className="relative">
        <div
          className={[
            'flex items-center justify-center rounded-full bg-neutral-800/90 border-2 border-white/20 shadow-lg',
            avatarSize,
            isCurrentTurn ? 'animate-pulse-glow border-yellow-300' : '',
          ].join(' ')}
        >
          <span role="img" aria-label={player.name}>
            {player.avatar}
          </span>
        </div>
        {player.isHost && (
          <span className="absolute -top-2.5 -right-1.5 text-base drop-shadow" title="Host">
            👑
          </span>
        )}
        {cardCountBadge && player.cardCount > 0 && (
          <span className="absolute -bottom-1.5 -right-1.5 rounded-full bg-red-700 border border-white/50 px-1.5 text-[0.65rem] font-bold leading-4">
            {player.cardCount}
          </span>
        )}
        {player.hasCalledUno && (
          <span className="absolute -bottom-1.5 -left-2 rounded-full bg-yellow-400 px-1.5 text-[0.6rem] font-black text-neutral-900 leading-4 animate-pulse">
            UNO!
          </span>
        )}
        {effect && (
          <span
            key={effect.id}
            className={`absolute left-1/2 -translate-x-1/2 z-30 pointer-events-none text-4xl ${
              effect.kind === 'reaction' ? 'animate-float-up' : 'animate-float-up text-5xl'
            }`}
            style={{ bottom: '70%' }}
          >
            {effect.emoji}
          </span>
        )}
      </div>
      <span className="max-w-20 truncate text-xs font-semibold text-white/90">
        {player.name}
      </span>
      {dim && <span className="text-[0.6rem] text-white/60 -mt-1">away</span>}
    </div>
  );
}
