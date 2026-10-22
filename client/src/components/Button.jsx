import { Loader2 } from 'lucide-react';

const VARIANTS = {
  primary: 'bg-brand text-white hover:bg-brand-hover border border-brand',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-page',
  danger: 'bg-surface text-bad border border-line-strong hover:bg-bad-soft hover:border-bad/40',
  ghost: 'bg-transparent text-ink-muted border border-transparent hover:bg-page hover:text-ink',
};

export function Button({ variant = 'secondary', size = 'md', loading = false, icon: Icon, children, className = '', disabled, ...rest }) {
  const sizing = size === 'sm' ? 'px-2.5 py-1 text-sm gap-1.5' : 'px-3.5 py-1.5 text-base gap-2';
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${sizing} ${VARIANTS[variant]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
      {children}
    </button>
  );
}
