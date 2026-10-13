import type { HouseRules } from '../shared/protocol';

const LABELS: { key: keyof HouseRules; label: string; title: string }[] = [
  { key: 'stacking', label: 'Stacking', title: '+2/+4 stacking is on' },
  { key: 'sevenZero', label: '7-0', title: '7 swaps hands, 0 rotates all hands' },
  { key: 'jumpIn', label: 'Jump-in', title: 'Exact matches can be played out of turn' },
];

// Small pills showing which house rules are active (lobby + in-game).
export function RuleBadges({ rules }: { rules: HouseRules }) {
  const active = LABELS.filter(({ key }) => rules[key]);
  if (active.length === 0) return null;
  return (
    <span className="flex gap-1">
      {active.map(({ key, label, title }) => (
        <span
          key={key}
          title={title}
          className="rounded-full bg-yellow-300/10 border border-yellow-300/30 px-2 py-0.5 text-[0.6rem] font-bold text-yellow-200"
        >
          {label}
        </span>
      ))}
    </span>
  );
}
