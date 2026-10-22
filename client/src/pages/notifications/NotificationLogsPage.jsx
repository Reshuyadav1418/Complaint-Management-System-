import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, RotateCcw } from 'lucide-react';
import { notificationApi } from '../../api/endpoints.js';
import { readError } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useAsync, useDebounced } from '../../lib/useAsync.js';
import { formatDateTime } from '../../lib/format.js';
import { NOTIFICATION_STATUS, NOTIFICATION_TYPES } from '../../lib/notifications.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Button } from '../../components/Button.jsx';
import { Modal } from '../../components/Modal.jsx';
import { NotificationStatus } from '../../components/NotificationStatus.jsx';
import { Pagination } from '../../components/Pagination.jsx';
import { Loading, ErrorState, EmptyState } from '../../components/States.jsx';
import { useToast } from '../../components/Toast.jsx';

function MessageModal({ id, onClose, onRetried }) {
  const { can } = useAuth();
  const notify = useToast();
  const msg = useAsync(() => (id ? notificationApi.get(id) : Promise.resolve({ data: null })), [id]);
  const [view, setView] = useState('html');
  const [busy, setBusy] = useState(false);
  const n = msg.data;

  const retry = async () => {
    setBusy(true);
    try {
      await notificationApi.retry(n._id);
      notify('Email requeued. It will be sent within a few seconds.');
      onRetried();
    } catch (err) {
      notify(readError(err).message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(id)}
      onClose={onClose}
      width="max-w-3xl"
      title={n ? n.subject : 'Email'}
      description={n ? `${NOTIFICATION_TYPES[n.type] || n.type} to ${n.recipient}` : null}
      footer={
        <>
          {n?.status === 'FAILED' && can('notifications.retry') && (
            <Button icon={RotateCcw} loading={busy} onClick={retry} className="mr-auto">Retry sending</Button>
          )}
          <Button variant="primary" onClick={onClose}>Close</Button>
        </>
      }
    >
      {!n ? (
        <Loading label="Loading email" />
      ) : (
        <div className="space-y-4">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
            <div><dt className="text-sm text-ink-muted">Status</dt><dd className="mt-0.5"><NotificationStatus status={n.status} /></dd></div>
            <div><dt className="text-sm text-ink-muted">Attempts</dt><dd className="mt-0.5">{n.attempts}</dd></div>
            <div><dt className="text-sm text-ink-muted">{n.sentAt ? 'Sent' : 'Queued'}</dt><dd className="mt-0.5">{formatDateTime(n.sentAt || n.createdAt)}</dd></div>
            {n.complaint && (
              <div><dt className="text-sm text-ink-muted">Complaint</dt><dd className="mt-0.5"><Link className="text-brand hover:underline" to={`/complaints/${n.complaint._id}`}>{n.complaint.complaintNumber}</Link></dd></div>
            )}
            {n.providerMessageId && <div className="sm:col-span-2"><dt className="text-sm text-ink-muted">Message ID</dt><dd className="mt-0.5 break-all text-sm">{n.providerMessageId}</dd></div>}
            {n.lastError && <div className="sm:col-span-3"><dt className="text-sm text-ink-muted">Last error</dt><dd className="mt-0.5 text-bad">{n.lastError}</dd></div>}
          </dl>
          <div>
            <div role="tablist" className="mb-2 flex gap-1">
              {['html', 'text'].map((v) => (
                <button key={v} role="tab" type="button" aria-selected={view === v} onClick={() => setView(v)}
                  className={`rounded px-2.5 py-1 text-sm font-medium ${view === v ? 'bg-brand-soft text-brand' : 'text-ink-muted hover:bg-page'}`}>
                  {v === 'html' ? 'As received' : 'Plain text'}
                </button>
              ))}
            </div>
            {view === 'html' && n.bodyHtml ? (
              // sandbox with no permissions: no scripts, no forms, no navigation.
              <iframe title="Email preview" sandbox="" srcDoc={n.bodyHtml} className="h-96 w-full rounded border border-line bg-page" />
            ) : (
              <pre className="whitespace-pre-wrap rounded border border-line px-4 py-3 font-sans">{n.bodyText}</pre>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

export function NotificationLogsPage() {
  const [filters, setFilters] = useState({ status: '', type: '', search: '', page: 1 });
  const search = useDebounced(filters.search);
  const list = useAsync(
    () => notificationApi.list({ status: filters.status || undefined, type: filters.type || undefined, search: search || undefined, page: filters.page }),
    [filters.status, filters.type, search, filters.page],
  );
  const [open, setOpen] = useState(null);

  return (
    <>
      <PageHeader title="Notification logs" description="Every email and WhatsApp message the system has queued, with its delivery status. Failed messages can be retried." />
      <div className="panel">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="relative min-w-[14rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <input className="field-input pl-8" placeholder="Search recipient, subject or complaint number" aria-label="Search notifications"
              value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value, page: 1 })} />
          </div>
          <select className="field-input w-auto" aria-label="Status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value, page: 1 })}>
            <option value="">All statuses</option>
            {Object.entries(NOTIFICATION_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select className="field-input w-auto" aria-label="Type" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value, page: 1 })}>
            <option value="">All types</option>
            {Object.entries(NOTIFICATION_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {list.loading && !list.data ? (
          <Loading label="Loading notifications" />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : list.data.length === 0 ? (
          <EmptyState title={filters.status || filters.type || filters.search ? 'No notifications match these filters' : 'No notifications yet'}>
            Emails appear here when a complaint is acknowledged, assigned or decided.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left">
              <thead className="border-b border-line bg-page/60 text-sm text-ink-muted">
                <tr>
                  <th className="py-2 pl-4 pr-3 font-medium">Queued</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Complaint</th>
                  <th className="px-3 py-2 font-medium">Recipient</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.data.map((n) => (
                  <tr key={n._id} className="cursor-pointer align-top hover:bg-page/60" onClick={() => setOpen(n._id)}>
                    <td className="whitespace-nowrap py-2.5 pl-4 pr-3 text-sm">{formatDateTime(n.createdAt)}</td>
                    <td className="px-3 py-2.5">{NOTIFICATION_TYPES[n.type] || n.type}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{n.complaint?.complaintNumber || <span className="text-ink-faint">—</span>}</td>
                    <td className="px-3 py-2.5">{n.recipient}</td>
                    <td className="px-3 py-2.5"><NotificationStatus status={n.status} /></td>
                    <td className="px-3 py-2.5 text-sm text-ink-muted">
                      {n.status === 'SENT' || n.status === 'DELIVERED'
                        ? `Sent ${formatDateTime(n.sentAt)}${n.attempts > 1 ? `, attempt ${n.attempts}` : ''}`
                        : n.lastError
                          ? <span className={n.status === 'FAILED' ? 'text-bad' : ''}>{n.status === 'FAILED' ? `${n.attempts} attempts: ` : `Retrying (${n.attempts}): `}{n.lastError}</span>
                          : 'Waiting to send'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination meta={list.meta} onPage={(page) => setFilters({ ...filters, page })} />
      </div>
      <MessageModal id={open} onClose={() => setOpen(null)} onRetried={() => { setOpen(null); list.reload(); }} />
    </>
  );
}
