import type { CSSProperties } from 'react';
import type { Card, CardValue, Color } from '../shared/protocol';

export const COLOR_BG: Record<Color, string> = {
  red: 'bg-red-600',
  yellow: 'bg-yellow-400',
  green: 'bg-green-600',
  blue: 'bg-blue-600',
};

export const COLOR_HEX: Record<Color, string> = {
  red: '#dc2626',
  yellow: '#facc15',
  green: '#16a34a',
  blue: '#2563eb',
};

const VALUE_LABEL: Record<CardValue, string> = {
  '0': '0', '1': '1', '2': '2', '3': '3', '4': '4',
  '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
  skip: '🚫',
  reverse: '🔄',
  draw2: '+2',
  wild: '🌈',
  wild4: '+4',
};

const SIZES = {
  xs: 'w-9 h-14 text-sm rounded-lg',
  sm: 'w-12 h-[4.5rem] text-xl rounded-xl',
  md: 'w-16 h-24 text-3xl rounded-2xl',
  lg: 'w-24 h-36 text-5xl rounded-2xl',
} as const;

interface CardViewProps {
  card: Card;
  size?: keyof typeof SIZES;
  playable?: boolean;
  dimmed?: boolean;
  shaking?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
  className?: string;
}

export function CardView({
  card,
  size = 'md',
  playable = false,
  dimmed = false,
  shaking = false,
  onClick,
  style,
  className = '',
}: CardViewProps) {
  const label = VALUE_LABEL[card.value];
  const base =
    card.color === 'wild'
      ? 'bg-neutral-900 text-white'
      : `${COLOR_BG[card.color]} ${card.color === 'yellow' ? 'text-neutral-900' : 'text-white'}`;
  const isWild = card.color === 'wild';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      style={style}
      className={[
        'relative shrink-0 select-none border-2 border-white/80 font-black shadow-lg shadow-black/40',
        'flex items-center justify-center transition-all duration-150',
        SIZES[size],
        base,
        playable ? '-translate-y-3 ring-4 ring-yellow-300/90 cursor-pointer hover:-translate-y-5' : '',
        dimmed ? 'opacity-40 saturate-50' : '',
        shaking ? 'animate-shake' : '',
        className,
      ].join(' ')}
      aria-label={`${card.color} ${card.value}`}
    >
      {/* white oval backdrop, UNO-ish */}
      <span className="absolute inset-[12%] rounded-[50%] bg-white/85 rotate-[-18deg]" />
      {isWild && (
        <span
          className="absolute inset-[12%] rounded-[50%] rotate-[-18deg] opacity-90"
          style={{
            background: `conic-gradient(${COLOR_HEX.red}, ${COLOR_HEX.yellow}, ${COLOR_HEX.green}, ${COLOR_HEX.blue}, ${COLOR_HEX.red})`,
            mask: 'radial-gradient(closest-side, transparent 55%, black 56%)',
            WebkitMask: 'radial-gradient(closest-side, transparent 55%, black 56%)',
          }}
        />
      )}
      <span
        className={`relative z-10 drop-shadow-[0_1px_1px_rgba(0,0,0,0.4)] ${
          !isWild && card.color !== 'yellow' ? 'text-neutral-900' : ''
        }`}
        style={{ textShadow: '0 0 2px rgba(255,255,255,0.35)' }}
      >
        {label}
      </span>
    </button>
  );
}

export function CardBack({
  size = 'md',
  count,
  onClick,
  className = '',
  style,
}: {
  size?: keyof typeof SIZES;
  count?: number;
  onClick?: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      style={style}
      className={[
        'relative shrink-0 select-none border-2 border-white/70 shadow-lg shadow-black/40',
        'bg-gradient-to-br from-red-700 via-red-600 to-red-800',
        'flex items-center justify-center',
        onClick ? 'cursor-pointer hover:-translate-y-1 transition-transform' : '',
        SIZES[size],
        className,
      ].join(' ')}
      aria-label="Card back"
    >
      <span className="absolute inset-[10%] rounded-[50%] bg-white/15 rotate-[-18deg]" />
      <span className="relative z-10 font-black italic text-white/90 tracking-tighter text-[0.55em] leading-none">
        UNO
      </span>
      {count !== undefined && count > 1 && (
        <span className="absolute -top-2 -right-2 z-20 rounded-full bg-neutral-900 border border-white/40 px-1.5 py-0.5 text-[0.6rem] font-bold text-white">
          {count}
        </span>
      )}
    </button>
  );
}
