import { Loader2, AlertTriangle } from 'lucide-react';
import { Button } from './Button.jsx';

export function Loading({ label = 'Loading' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-ink-muted" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span>{label}…</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <AlertTriangle className="h-5 w-5 text-bad" aria-hidden />
      <p className="max-w-md text-ink">{message}</p>
      {onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="font-medium text-ink">{title}</p>
      {children && <p className="max-w-md text-ink-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
