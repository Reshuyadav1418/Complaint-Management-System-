import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/** Accessible dialog built on the native <dialog> element. */
export function Modal({ open, title, description, onClose, children, footer, width = 'max-w-lg' }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={`w-[calc(100%-2rem)] ${width} rounded-md border border-line bg-surface p-0 text-ink shadow-overlay backdrop:bg-ink/30`}
      aria-labelledby="modal-title"
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
            <div>
              <h2 id="modal-title" className="text-lg font-semibold">{title}</h2>
              {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
            </div>
            <button type="button" onClick={onClose} className="rounded p-1 text-ink-muted hover:bg-page hover:text-ink" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line bg-page/60 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
