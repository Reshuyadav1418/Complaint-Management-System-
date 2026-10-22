import { useId } from 'react';

/**
 * Label + control + hint/error, wired for screen readers.
 * Pass a render function to get the generated id and aria props.
 */
export function Field({ label, error, hint, required, children, className = '' }) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const control = children({ id, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': describedBy, required });
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink">
        {label}
        {required && <span className="ml-0.5 text-bad" aria-hidden>*</span>}
      </label>
      {control}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-sm text-bad">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-sm text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextInput({ field, ...rest }) {
  return <input className="field-input" {...field} {...rest} />;
}
