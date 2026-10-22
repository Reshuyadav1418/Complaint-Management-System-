import { useEffect, useRef, useState } from 'react';
import { readError } from '../api/client.js';
import { Modal } from './Modal.jsx';
import { Button } from './Button.jsx';
import { Field } from './Field.jsx';

/**
 * Confirmation for a workflow step, with optional remarks. Generates one
 * idempotency key per opening so a retried click is recognised by the server.
 */
export function ConfirmModal({ open, title, description, confirmLabel, remarksLabel = 'Remarks', remarksHint, children, onConfirm, onClose }) {
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const key = useRef('');

  useEffect(() => {
    if (open) {
      key.current = `act-${crypto.randomUUID()}`;
      setRemarks('');
      setError(null);
    }
  }, [open]);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ remarks: remarks || undefined, idempotencyKey: key.current });
    } catch (err) {
      const details = err.response?.data?.error?.details;
      setError(details?.length ? details.map((d) => d.message) : [readError(err).message]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title} description={description}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={go}>{confirmLabel}</Button></>}>
      {error && (
        <ul className="mb-4 space-y-1 rounded border border-bad/20 bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">
          {error.map((m) => <li key={m}>{m}</li>)}
        </ul>
      )}
      {children}
      <Field label={remarksLabel} hint={remarksHint}>
        {(p) => <textarea {...p} rows={2} maxLength={2000} className="field-input" value={remarks} onChange={(e) => setRemarks(e.target.value)} />}
      </Field>
    </Modal>
  );
}
