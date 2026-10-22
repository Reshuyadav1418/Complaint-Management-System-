const TONES = {
  neutral: 'bg-page text-ink-muted border-line',
  brand: 'bg-brand-soft text-brand border-brand/20',
  ok: 'bg-ok-soft text-ok border-ok/20',
  warn: 'bg-warn-soft text-warn border-warn/20',
  bad: 'bg-bad-soft text-bad border-bad/20',
};

export function Badge({ tone = 'neutral', children }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded border px-1.5 py-px text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}
