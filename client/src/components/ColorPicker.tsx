import type { Color } from '../shared/protocol';
import { COLOR_HEX } from './CardView';

interface ColorPickerProps {
  onPick: (color: Color) => void;
  onCancel: () => void;
}

const COLORS: { color: Color; label: string }[] = [
  { color: 'red', label: 'Red' },
  { color: 'yellow', label: 'Yellow' },
  { color: 'green', label: 'Green' },
  { color: 'blue', label: 'Blue' },
];

export function ColorPicker({ onPick, onCancel }: ColorPickerProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label="Choose a color"
    >
      <div
        className="animate-pop rounded-3xl bg-neutral-900/95 border border-white/10 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-center text-lg font-bold mb-4">Pick a color</p>
        <div className="grid grid-cols-2 gap-3">
          {COLORS.map(({ color, label }) => (
            <button
              key={color}
              type="button"
              onClick={() => onPick(color)}
              aria-label={label}
              className="h-20 w-20 sm:h-24 sm:w-24 rounded-2xl border-2 border-white/70 shadow-lg transition-transform hover:scale-110 active:scale-95"
              style={{ backgroundColor: COLOR_HEX[color] }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
