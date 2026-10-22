import { ChevronLeft, ChevronRight } from 'lucide-react';

export function Pagination({ meta, onPage }) {
  if (!meta || meta.total === 0) return null;
  const from = (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.total, meta.page * meta.limit);
  return (
    <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-sm text-ink-muted">
      <span>
        {from}–{to} of {meta.total}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="rounded p-1 hover:bg-page disabled:opacity-40"
          onClick={() => onPage(meta.page - 1)}
          disabled={meta.page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="px-1">
          Page {meta.page} of {meta.totalPages}
        </span>
        <button
          type="button"
          className="rounded p-1 hover:bg-page disabled:opacity-40"
          onClick={() => onPage(meta.page + 1)}
          disabled={meta.page >= meta.totalPages}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
