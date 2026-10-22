import { useEffect } from 'react';
import { complaintApi } from '../../api/endpoints.js';
import { useAsync } from '../../lib/useAsync.js';
import { formatDateTime } from '../../lib/format.js';
import { Loading, ErrorState } from '../../components/States.jsx';

const LABELS = {
  'complaint.create': 'registered the complaint',
  'complaint.d1.update': 'edited D1 details',
  'complaint.attachment.upload': 'uploaded files',
  'complaint.d1.acknowledge': 'approved the acknowledgement',
  'notification.sent': 'sent an email',
  'notification.failed': 'could not send an email',
  'notification.retry': 'requeued an email',
  'complaint.d2.update': 'edited D2 information',
  'complaint.d3.analysis.update': 'edited the analysis',
};

function describe(e) {
  if (e.action.startsWith('complaint.status.')) {
    const verb = e.action === 'complaint.status.register' ? 'Status set' : 'Moved';
    return `${verb}: ${e.summary}`;
  }
  return e.summary || LABELS[e.action] || e.action;
}

function changedFields(e) {
  if (e.action === 'complaint.d2.update' && e.after) {
    const keys = new Set([...Object.keys(e.after), ...Object.keys(e.before || {})]);
    const nice = (k) => k.replace(/^(verifiedProduct|investigation)\./, '').replace(/\.(value|score)$/, ' $1').replace(/([A-Z])/g, ' $1').toLowerCase();
    return [...keys].map(nice).join(', ');
  }
  if (e.action !== 'complaint.d1.update' || !e.after) return null;
  const names = { requester: 'requester', customer: 'customer', reportedProduct: 'reported product', shortDescription: 'description', additionalRemarks: 'remarks', headQuarter: 'head quarter', complaintDate: 'complaint date' };
  return Object.keys(e.after).map((k) => names[k] || k).join(', ');
}

/** Chronological record of everything that happened to the complaint. */
export function HistoryPanel({ complaintId, refreshKey }) {
  const history = useAsync(() => complaintApi.history(complaintId), [complaintId]);
  useEffect(() => {
    if (refreshKey) history.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  return (
    <section className="panel">
      <h2 className="border-b border-line px-4 py-3 font-semibold">History</h2>
      {history.loading && !history.data ? (
        <Loading label="Loading history" />
      ) : history.error ? (
        <ErrorState message={history.error} onRetry={history.reload} />
      ) : (
        <ol className="relative max-h-[32rem] overflow-y-auto px-4 py-3">
          {history.data.map((e, i) => (
            <li key={e._id} className="relative pb-4 pl-5 last:pb-0">
              {i < history.data.length - 1 && <span className="absolute left-[3px] top-2 h-full w-px bg-line" aria-hidden />}
              <span className={`absolute left-0 top-1.5 h-[7px] w-[7px] rounded-full ${e.action.startsWith('complaint.status.') ? 'bg-brand' : 'bg-line-strong'}`} aria-hidden />
              <p className="text-sm">
                <span className="font-medium">{e.actorName || 'System'}</span>{' '}
                <span>{describe(e).charAt(0).toLowerCase() + describe(e).slice(1)}</span>
              </p>
              {changedFields(e) && <p className="text-xs text-ink-muted">Changed {changedFields(e)}</p>}
              {e.after?.remarks && !e.action.startsWith('complaint.status.') && <p className="mt-0.5 text-sm text-ink-muted">“{e.after.remarks}”</p>}
              <time className="text-xs text-ink-faint" dateTime={e.at}>{formatDateTime(e.at)}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
