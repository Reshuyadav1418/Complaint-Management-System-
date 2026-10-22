import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { d3Api } from '../../api/endpoints.js';
import { readError } from '../../api/client.js';
import { useAsync } from '../../lib/useAsync.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import { Modal } from '../../components/Modal.jsx';
import { Button } from '../../components/Button.jsx';
import { Badge } from '../../components/Badge.jsx';
import { Field } from '../../components/Field.jsx';
import { Loading } from '../../components/States.jsx';
import { FishboneDiagram } from './FishboneDiagram.jsx';

/* ---------------- Submit / resubmit ---------------- */

export function SubmitD3Modal({ open, complaint, resubmit, onClose, onDone }) {
  const [ready, setReady] = useState(null);
  const [reviewers, setReviewers] = useState([]);
  const [reviewerId, setReviewerId] = useState('');
  const [remarks, setRemarks] = useState('');
  const [errors, setErrors] = useState(null);
  const [busy, setBusy] = useState(false);
  const key = useRef('');

  useEffect(() => {
    if (!open) return;
    key.current = `sub-${crypto.randomUUID()}`;
    setErrors(null);
    setRemarks('');
    setReady(null);
    Promise.all([d3Api.readiness(complaint._id), d3Api.reviewerCandidates()])
      .then(([r, c]) => {
        setReady(r.data.issues);
        setReviewers(c.data);
        setReviewerId((prev) => prev || (c.data.length === 1 ? c.data[0]._id : ''));
      })
      .catch((err) => setErrors([readError(err).message]));
  }, [open, complaint._id]);

  const submit = async () => {
    setBusy(true);
    setErrors(null);
    try {
      const res = await d3Api.submit(complaint._id, { reviewerId, remarks: remarks || undefined, idempotencyKey: key.current });
      onDone(res.data, reviewers.find((r) => r._id === reviewerId)?.name);
    } catch (err) {
      const details = err.response?.data?.error?.details;
      setErrors(details?.length ? details.map((d) => d.message) : [readError(err).message]);
    } finally {
      setBusy(false);
    }
  };

  const blocked = ready?.length > 0;
  return (
    <Modal open={open} onClose={onClose} width="max-w-xl"
      title={resubmit ? 'Resubmit for approval' : 'Submit for approval'}
      description={`${complaint.complaintNumber}. The analysis is locked while it is reviewed, and the reviewer is emailed.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={Send} loading={busy} disabled={!ready || blocked || !reviewerId} onClick={submit}>{resubmit ? 'Resubmit' : 'Submit'}</Button></>}>
      {errors && (
        <ul className="mb-4 space-y-0.5 rounded border border-bad/20 bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">{errors.map((m) => <li key={m}>{m}</li>)}</ul>
      )}
      {!ready && !errors ? (
        <Loading label="Checking the analysis" />
      ) : blocked ? (
        <div className="rounded border border-warn/30 bg-warn-soft px-4 py-3">
          <p className="font-medium text-warn">Complete these before submitting</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-ink">{ready.map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      ) : ready ? (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-ok">✓ The analysis has everything needed for review.</p>
          <Field label="Reviewer" required hint="The person who will approve or reject this analysis.">
            {(p) => (
              <select {...p} className="field-input" value={reviewerId} onChange={(e) => setReviewerId(e.target.value)}>
                <option value="">Select a reviewer</option>
                {reviewers.map((r) => <option key={r._id} value={r._id}>{r.name}{r.designation ? `, ${r.designation}` : ''}</option>)}
              </select>
            )}
          </Field>
          {reviewers.length === 0 && <p className="text-sm text-bad">No active user can review D3. An administrator needs to give someone the Reviewer role.</p>}
          <Field label={resubmit ? 'What changed since the rejection' : 'Remarks for the reviewer'} hint="Optional, but helps the reviewer.">
            {(p) => <textarea {...p} rows={3} maxLength={2000} className="field-input" value={remarks} onChange={(e) => setRemarks(e.target.value)} />}
          </Field>
        </div>
      ) : null}
    </Modal>
  );
}

/* ---------------- Status banner ---------------- */

export function ReviewBanner({ complaint, review, latestRejection }) {
  if (!review || complaint.stage !== 'D3' && complaint.status !== 'D3_APPROVED') return null;
  const s = complaint.status;
  if (s === 'D3_PENDING_APPROVAL') {
    return (
      <div className="rounded border border-warn/30 bg-warn-soft px-4 py-3">
        <p className="font-medium text-warn">Waiting for approval{review.version > 1 ? ` (version ${review.version})` : ''}</p>
        <p className="text-sm text-ink">Submitted by {review.submittedBy?.name} on {formatDateTime(review.submittedAt)} to {review.reviewer?.name || 'the reviewer'}. The analysis is locked until a decision is made.</p>
      </div>
    );
  }
  if (s === 'D3_REWORK') {
    return (
      <div className="rounded border border-bad/25 bg-bad-soft px-4 py-3">
        <p className="font-medium text-bad">Returned for rework</p>
        {latestRejection && (
          <>
            <p className="mt-1 text-sm text-ink">{latestRejection.actor?.name} rejected version {latestRejection.version} on {formatDateTime(latestRejection.at)}:</p>
            <blockquote className="mt-1 border-l-2 border-bad/40 pl-3 text-ink">{latestRejection.remarks}</blockquote>
          </>
        )}
        <p className="mt-1.5 text-sm text-ink-muted">Correct the analysis below, then resubmit it from the next-step panel.</p>
      </div>
    );
  }
  if (s === 'D3_APPROVED') {
    return (
      <div className="rounded border border-ok/25 bg-ok-soft px-4 py-3">
        <p className="font-medium text-ok">Analysis approved{review.version > 1 ? ` (version ${review.version})` : ''}</p>
        <p className="text-sm text-ink">The root causes and CAPA are approved. CAPA actions still need to be carried out and verified.</p>
      </div>
    );
  }
  return null;
}

/* ---------------- Review history ---------------- */

const KIND = {
  SUBMISSION: ['Submitted', 'neutral'],
  APPROVAL: ['Approved', 'ok'],
  REJECTION: ['Rejected', 'bad'],
};

function SnapshotModal({ entry, complaintNumber, onClose }) {
  const s = entry?.snapshot;
  return (
    <Modal open={Boolean(entry)} onClose={onClose} width="max-w-4xl"
      title={entry ? `Version ${entry.version} as submitted` : ''}
      description={entry ? `Submitted by ${entry.actor?.name} on ${formatDateTime(entry.at)}${s?.reviewer ? ` to ${s.reviewer.name}` : ''}. This is a frozen copy; later edits do not change it.` : ''}
      footer={<Button variant="primary" onClick={onClose}>Close</Button>}>
      {s && (
        <div className="space-y-5">
          <p><span className="text-ink-muted">Problem: </span>{s.problemStatement}</p>
          {s.whyWhy?.length > 0 && (
            <div>
              <h4 className="mb-1 font-semibold">Why-Why</h4>
              <ol className="space-y-1">{s.whyWhy.map((w) => <li key={w.level}><span className="font-medium text-ink-muted">Why {w.level}:</span> {w.why} <span className="text-ink-muted">→</span> {w.because}</li>)}</ol>
            </div>
          )}
          {s.methods?.includes('FISHBONE') && (
            <div>
              <h4 className="mb-2 font-semibold">Fishbone</h4>
              <FishboneDiagram categories={Object.keys(s.fishbone)} tree={s.fishbone} problem={s.problemStatement} complaintNumber={`${complaintNumber}-v${entry.version}`} />
            </div>
          )}
          <div>
            <h4 className="mb-1 font-semibold">Root causes and CAPA</h4>
            <ul className="space-y-2">
              {s.rootCauses.map((rc) => (
                <li key={rc._id} className="rounded border border-line px-3 py-2">
                  <p><Badge>{rc.category}</Badge> {rc.description}</p>
                  {rc.capas.map((c) => (
                    <p key={c._id} className="mt-1 text-sm">
                      <span className="font-medium">{c.capaNumber}</span>
                      {c.capaRequired
                        ? <> · {c.correctiveAction}{c.preventiveAction ? <>; preventive: {c.preventiveAction}</> : <span className="text-ink-faint">; no preventive action</span>} · {c.responsiblePerson}, due {formatDate(c.targetDate)}</>
                        : <> · not required: {c.description}</>}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function ReviewHistory({ complaintId, complaintNumber, refreshKey, onLoaded }) {
  const reviews = useAsync(() => d3Api.reviews(complaintId), [complaintId, refreshKey]);
  const [open, setOpen] = useState(null);
  useEffect(() => { if (reviews.data) onLoaded?.(reviews.data); }, [reviews.data]); // eslint-disable-line
  if (!reviews.data?.length) return null;
  return (
    <section className="border-t border-line pt-5">
      <h3 className="font-semibold">Review history</h3>
      <p className="mb-3 text-sm text-ink-muted">Every submission is kept exactly as submitted, including rejected versions.</p>
      <ol className="divide-y divide-line rounded border border-line">
        {reviews.data.map((r) => (
          <li key={r._id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-3 py-2.5">
            <span className="w-24 shrink-0"><Badge tone={KIND[r.kind]?.[1]}>{KIND[r.kind]?.[0] || r.kind}</Badge></span>
            <div className="min-w-0 flex-1">
              <p><span className="font-medium">Version {r.version}</span> <span className="text-ink-muted">by {r.actor?.name}, {formatDateTime(r.at)}</span></p>
              {r.remarks && <p className="text-sm text-ink-muted">“{r.remarks}”</p>}
            </div>
            {r.kind === 'SUBMISSION' && <Button size="sm" variant="ghost" onClick={() => setOpen(r)}>View as submitted</Button>}
          </li>
        ))}
      </ol>
      <SnapshotModal entry={open} complaintNumber={complaintNumber} onClose={() => setOpen(null)} />
    </section>
  );
}
