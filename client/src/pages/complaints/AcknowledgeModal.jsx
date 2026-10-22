import { useEffect, useRef, useState } from 'react';
import { Mail } from 'lucide-react';
import { complaintApi } from '../../api/endpoints.js';
import { readError } from '../../api/client.js';
import { Modal } from '../../components/Modal.jsx';
import { Button } from '../../components/Button.jsx';
import { Field } from '../../components/Field.jsx';
import { Loading } from '../../components/States.jsx';

const newKey = () => `ack-${crypto.randomUUID()}`;

/**
 * Shows exactly what the requester will receive before approving.
 * One idempotency key per dialog: if the request times out and the user
 * presses the button again, the server recognises the repeat.
 */
export function AcknowledgeModal({ open, complaint, onClose, onDone }) {
  const [preview, setPreview] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newKey());

  useEffect(() => {
    if (!open) return;
    key.current = newKey();
    setRemarks('');
    setError(null);
    setPreview(null);
    complaintApi
      .acknowledgementPreview(complaint._id)
      .then((r) => setPreview(r.data))
      .catch((err) => setError(readError(err).message));
  }, [open, complaint._id]);

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await complaintApi.acknowledge(complaint._id, { remarks: remarks || undefined, idempotencyKey: key.current });
      onDone(res.data, preview?.to);
    } catch (err) {
      const e = readError(err);
      setError(e.code === 'VALIDATION_FAILED' ? err.response.data.error.details.map((d) => d.message).join(' ') : e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-2xl"
      title="Approve acknowledgement"
      description={`${complaint.complaintNumber}. The complaint moves to “Acknowledged”, D1 details are locked, and this email is sent to the requester.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Mail} loading={busy} disabled={!preview?.to} onClick={approve}>
            Approve and send email
          </Button>
        </>
      }
    >
      {error && <p className="mb-4 rounded border border-bad/20 bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">{error}</p>}
      {!preview && !error ? (
        <Loading label="Preparing email" />
      ) : preview ? (
        <div className="space-y-4">
          <div className="rounded border border-line">
            <dl className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1 border-b border-line bg-page/60 px-4 py-2.5 text-sm">
              <dt className="text-ink-muted">To</dt>
              <dd>{preview.to || <span className="text-bad">No requester email. Add one in D1 before approving.</span>}</dd>
              <dt className="text-ink-muted">Subject</dt>
              <dd className="font-medium">{preview.subject}</dd>
            </dl>
            <pre className="whitespace-pre-wrap px-4 py-3 font-sans text-base">{preview.text}</pre>
          </div>
          <Field label="Internal remarks" hint="Optional. Recorded in the complaint history; never sent to the requester.">
            {(p) => <textarea {...p} rows={2} maxLength={2000} className="field-input" value={remarks} onChange={(e) => setRemarks(e.target.value)} />}
          </Field>
        </div>
      ) : null}
    </Modal>
  );
}
