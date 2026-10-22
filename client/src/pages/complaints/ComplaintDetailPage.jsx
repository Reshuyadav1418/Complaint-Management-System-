import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Check, Pencil, Lock } from 'lucide-react';
import { complaintApi } from '../../api/endpoints.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { readError } from '../../api/client.js';
import { useAsync } from '../../lib/useAsync.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import { STAGE_ORDER, STAGE_NAMES } from '../../lib/complaints.js';
import { Button } from '../../components/Button.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { Loading, ErrorState } from '../../components/States.jsx';
import { useToast } from '../../components/Toast.jsx';
import { D1Form, toForm, toBody } from './D1Form.jsx';
import { FilesTab } from './FilesTab.jsx';
import { HistoryPanel } from './HistoryPanel.jsx';
import { AcknowledgeModal } from './AcknowledgeModal.jsx';
import { D2Tab } from './D2Tab.jsx';
import { D3Tab } from './D3Tab.jsx';
import { SubmitD3Modal } from './D3Review.jsx';
import { d3Api } from '../../api/endpoints.js';
import { ConfirmModal } from '../../components/ConfirmModal.jsx';
import { NotificationStatus } from '../../components/NotificationStatus.jsx';
import { NOTIFICATION_TYPES } from '../../lib/notifications.js';
import { D4Tab } from './D4Tab.jsx';
import { generateComplaintReport } from '../../lib/generateReportPdf.js';

/* ---------------- Stage tracker ---------------- */

// Statuses where the current stage's own work is finished, awaiting the next stage.
const SF_STAGES = [
  { key: 'D1', label: 'D1-Define The Problem' },
  { key: 'D2', label: 'D2-Grasp The Situation' },
  { key: 'D3', label: 'D3- RCA & CAPA' },
  { key: 'D4', label: 'D4- Effectiveness Review' },
  { key: 'CLOSED', label: 'Closed' },
];

function StageTracker({ stage, status, onSelectTab }) {
  const currentIndex = SF_STAGES.findIndex((s) => s.key === stage);
  return (
    <div className="w-full overflow-x-auto bg-[#f8fafc] border-t border-slate-200 py-2 px-3 sm:px-5 no-scrollbar">
      <div className="flex items-center min-w-[720px] rounded-md shadow-xs overflow-hidden border border-slate-300">
        {SF_STAGES.map((s, idx) => {
          const isDone = idx < currentIndex || stage === 'CLOSED';
          const isCurrent = s.key === stage;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onSelectTab && onSelectTab(s.key === 'CLOSED' ? 'D4' : s.key)}
              className={`flex-1 relative h-9 px-2 sm:px-4 flex items-center justify-center text-xs font-semibold transition-all border-r border-white/40 last:border-r-0 ${
                isCurrent
                  ? 'bg-blue-600 text-white font-bold ring-1 ring-blue-700 z-10'
                  : isDone
                  ? 'bg-blue-800 text-white hover:bg-blue-900'
                  : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
              }`}
            >
              <div className="flex items-center gap-1.5 truncate">
                {isDone && <Check className="h-3.5 w-3.5 text-emerald-300 shrink-0" />}
                <span className="truncate">{s.label}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Next step ---------------- */

function NextStep({ actions, status, handlers, extraBlockers = {} }) {
  if (status === 'CLOSED') return null;
  if (!actions.length) {
    return <p className="text-ink-muted">No action is available on this complaint from your role at this stage.</p>;
  }
  return (
    <div className="space-y-2">
      {actions.map((a) => {
        const extra = extraBlockers[a.action];
        const handler = extra ? null : handlers[a.action];
        const blockers = extra ? [...a.blockers, extra] : a.blockers;
        return (
          <div key={a.action} className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium">Next step: {a.label}</p>
              {blockers.length > 0 ? (
                <ul className="mt-0.5 text-sm text-ink-muted">
                  {blockers.map((b) => <li key={b}>{b}</li>)}
                </ul>
              ) : handler ? (
                <p className="text-sm text-ink-muted">Moves the complaint to “{a.toLabel}”.</p>
              ) : (
                <p className="text-sm text-ink-muted">This step is switched on in build phase {a.phase}.</p>
              )}
            </div>
            <Button variant={a.action === 'rejectD3' ? 'danger' : 'primary'} disabled={!a.allowed || !handler} onClick={handler}>
              {a.label}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- D1 tab ---------------- */

function Item({ label, children, empty = 'Not provided' }) {
  return (
    <div>
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="mt-0.5 break-words">{children || <span className="text-ink-faint">{empty}</span>}</dd>
    </div>
  );
}

function EmailStatus({ complaintId, refreshKey }) {
  const emails = useAsync(() => complaintApi.notifications(complaintId), [complaintId, refreshKey]);
  const ack = emails.data?.filter((n) => n.type === 'D1_ACKNOWLEDGEMENT') || [];
  if (emails.loading && !emails.data) return null;
  if (!ack.length) return null;
  return (
    <ul className="mt-3 space-y-2">
      {ack.map((n) => (
        <li key={n._id} className="rounded border border-line px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">{NOTIFICATION_TYPES[n.type]} email to {n.recipient}</span>
            <NotificationStatus status={n.status} />
          </div>
          <p className="mt-0.5 text-sm text-ink-muted">
            {n.status === 'SENT' || n.status === 'DELIVERED'
              ? `Sent ${formatDateTime(n.sentAt)}${n.attempts > 1 ? ` after ${n.attempts} attempts` : ''}.`
              : n.status === 'FAILED'
                ? `Failed after ${n.attempts} attempts: ${n.lastError}`
                : n.attempts > 0
                  ? `Attempt ${n.attempts} failed (${n.lastError}). Next try ${formatDateTime(n.nextAttemptAt)}.`
                  : 'Queued; usually sent within a few seconds.'}
          </p>
        </li>
      ))}
    </ul>
  );
}

function D1Tab({ detail, onSaved, refreshKey }) {
  const { complaint: c, can } = detail;
  const notify = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(toForm(c));
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);

  const start = () => {
    setForm(toForm(c));
    setErrors({});
    setMessage(null);
    setConflict(false);
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      const res = await complaintApi.updateD1(c._id, { ...toBody(form, { includeOrigin: false, original: c }), version: c.__v });
      notify('D1 details saved.');
      setEditing(false);
      onSaved(res.data);
    } catch (err) {
      const e = readError(err);
      setErrors(e.fields);
      setConflict(e.code === 'CONFLICT');
      setMessage(Object.keys(e.fields).length ? 'Some fields need attention.' : e.message);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div>
        {message && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded border border-bad/20 bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">
            <span>{message}</span>
            {conflict && <Button size="sm" onClick={() => window.location.reload()}>Reload</Button>}
          </div>
        )}
        <D1Form value={form} onChange={setForm} errors={errors} />
        <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>Save D1 details</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        {can.editD1 ? (
          <p className="text-sm text-ink-muted">These details can be corrected until the complaint is acknowledged.</p>
        ) : (
          <p className="flex items-center gap-1.5 text-sm text-ink-muted">
            <Lock className="h-3.5 w-3.5" aria-hidden />
            {['SUBMITTED', 'D1_ACK_PENDING'].includes(c.status) ? 'Your role can view but not edit D1.' : 'D1 is locked after acknowledgement.'}
          </p>
        )}
        {can.editD1 && <Button size="sm" icon={Pencil} onClick={start}>Edit D1</Button>}
      </div>

      <section>
        <h3 className="mb-3 font-semibold">Complaint</h3>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <Item label="Complaint date">{formatDate(c.complaintDate)}</Item>
          <Item label="Origin">{c.origin}</Item>
          <Item label="Category">{c.category}</Item>
          <Item label="SBU">{c.sbu}</Item>
          <Item label="Country">{c.country}</Item>
          <Item label="Complaint head quarter">{c.headQuarter}</Item>
        </dl>
        <dl className="mt-4 space-y-4">
          <Item label="Short description">{c.shortDescription}</Item>
          <Item label="Additional remarks">{c.additionalRemarks && <span className="whitespace-pre-line">{c.additionalRemarks}</span>}</Item>
        </dl>
      </section>

      <section className="border-t border-line pt-5">
        <h3 className="mb-3 font-semibold">Requester</h3>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <Item label="Requested by">{c.requester?.name}</Item>
          <Item label="Reporter type">{c.requester?.type}</Item>
          <Item label="Email">{c.requester?.email && <a className="text-brand hover:underline" href={`mailto:${c.requester.email}`}>{c.requester.email}</a>}</Item>
          <Item label="Mobile">{c.requester?.mobile}</Item>
        </dl>
      </section>

      <section className="border-t border-line pt-5">
        <h3 className="mb-3 font-semibold">Customer and product</h3>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <Item label="Distributor / retailer">{c.customer?.name}</Item>
          <Item label="Customer code">{c.customer?.code}</Item>
          <Item label="Product (as reported)">{c.reportedProduct?.name}</Item>
          <Item label="Batch (as reported)">{c.reportedProduct?.batchNumber}</Item>
        </dl>
      </section>

      <section className="border-t border-line pt-5">
        <h3 className="mb-3 font-semibold">Acknowledgement</h3>
        {c.acknowledgement?.approvedAt ? (
          <>
            <p>
              Approved by {c.acknowledgement.approvedBy?.name} on {formatDateTime(c.acknowledgement.approvedAt)}.
            </p>
            {c.acknowledgement.remarks && <p className="mt-1 text-ink-muted">Remarks: {c.acknowledgement.remarks}</p>}
          </>
        ) : (
          <p className="text-ink-muted">Not acknowledged yet.</p>
        )}
        <EmailStatus complaintId={c._id} refreshKey={refreshKey} />
      </section>
    </div>
  );
}

/* ---------------- Later-stage and SLA tabs ---------------- */

const LATER = {
  D4: { phase: 8, what: 'verification and closure, once the business rules for this stage are confirmed' },
};

function LaterTab({ stage, complaint }) {
  const info = LATER[stage];
  return (
    <div className="space-y-3">
      <p className="text-ink-muted">
        This stage records {info.what}. Its forms arrive in build phase {info.phase}.
      </p>
    </div>
  );
}

function SlaTab({ complaint: c }) {
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      <Item label="Registered">{formatDateTime(c.createdAt)}</Item>
      <Item label="Last activity">{formatDateTime(c.lastActivityAt)}</Item>
      <Item label="Current stage due">
        {c.stageDueAt ? formatDateTime(c.stageDueAt) : <span className="text-ink-muted">No deadline. SLA rules are not configured yet.</span>}
      </Item>
      <Item label="Closed">{c.closedAt ? formatDateTime(c.closedAt) : <span className="text-ink-muted">Open</span>}</Item>
    </dl>
  );
}

/* ---------------- Page ---------------- */

const TABS = [
  { key: 'files', label: 'Synced Files' },
  { key: 'D1', label: 'D1-Define The Problem' },
  { key: 'D2', label: 'D2-Grasp The Situation' },
  { key: 'D3', label: 'D3- RCA & CAPA' },
  { key: 'D4', label: 'D4- Effectiveness Review' },
  { key: 'sla', label: 'SLA' },
];

export function ComplaintDetailPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const [historyKey, setHistoryKey] = useState(0);
  const { user } = useAuth();
  const [acking, setAcking] = useState(false);
  const [completingD2, setCompletingD2] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deciding, setDeciding] = useState(null); // 'approve' | 'reject'
  const [extensionModal, setExtensionModal] = useState(false);
  const [extHours, setExtHours] = useState('');
  const [extReason, setExtReason] = useState('');
  const [savingExt, setSavingExt] = useState(false);

  const notify = useToast();
  const load = useAsync(() => complaintApi.get(id), [id]);
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    if (load.data) setDetail(load.data);
  }, [load.data]);

  if (load.loading && !detail) return <Loading label="Loading complaint" />;
  if (load.error && !detail) {
    return (
      <div className="panel">
        <ErrorState message={load.error} onRetry={load.reload} />
        <p className="pb-6 text-center">
          <Link to="/complaints" className="text-brand hover:underline">Back to complaints</Link>
        </p>
      </div>
    );
  }
  if (!detail) return null;

  const c = detail.complaint;
  const defaultTab = ['D1', 'D2', 'D3', 'D4'].includes(c.stage) ? c.stage : 'D1';
  const tab = TABS.find((t) => t.key === params.get('tab'))?.key || defaultTab;
  const refreshed = (next) => {
    setDetail(next);
    setHistoryKey((k) => k + 1);
  };

  const handleGeneratePdf = async () => {
    try {
      const d3Data = await d3Api.get(c._id).catch(() => null);
      generateComplaintReport(c, d3Data);
      notify('Complaint Management Report PDF downloaded successfully.');
    } catch (err) {
      notify(readError(err).message, 'bad');
    }
  };

  const handleRequestExtension = async (e) => {
    e.preventDefault();
    try {
      setSavingExt(true);
      await complaintApi.requestSlaExtension(c._id, { hours: Number(extHours), reason: extReason });
      notify('D2 SLA extension request submitted to FRP manager.');
      setExtensionModal(false);
      refreshed({ ...detail, complaint: { ...c, d2: { ...c.d2, slaExtension: { requestedHours: Number(extHours), reason: extReason, status: 'PENDING' } } } });
    } catch (err) {
      notify(readError(err).message, 'bad');
    } finally {
      setSavingExt(false);
    }
  };

  return (
    <>
      <Link to="/complaints" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ChevronLeft className="h-4 w-4" aria-hidden /> Complaints
      </Link>

      <header className="panel mb-5 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-bold tracking-tight text-slate-900">{c.complaintNumber}</h1>
              <StatusBadge status={c.status} label={c.statusLabel} />
            </div>
            <p className="mt-1 max-w-2xl text-ink">{c.shortDescription}</p>
            <p className="mt-1 text-sm text-ink-muted">
              Received {formatDate(c.complaintDate)} via {c.origin}
              {c.createdBy?.name ? `, registered by ${c.createdBy.name}` : ''}. {c.requester?.name}, {c.country}.
            </p>
          </div>

          {/* Quick Action Buttons (PDF Page 7, 10, 24) */}
          <div className="flex flex-wrap items-center gap-2">
            {c.stage === 'D2' && (
              <Button size="sm" variant="secondary" onClick={() => setExtensionModal(true)}>
                D2 SLA Extension
              </Button>
            )}
            {c.stage === 'D3' && (
              <Button size="sm" variant="secondary" onClick={() => setSubmitting(true)}>
                Submit for Approval
              </Button>
            )}
            <Button size="sm" variant="primary" onClick={handleGeneratePdf}>
              Generate PDF
            </Button>
          </div>
        </div>

        <StageTracker stage={c.stage} status={c.status} onSelectTab={(t) => setParams({ tab: t }, { replace: true })} />

        <div className="border-t border-line bg-page/50 px-5 py-3">
          <NextStep actions={detail.nextActions} status={c.status} handlers={{
            acknowledge: () => setAcking(true),
            startD2: async () => {
              try {
                const res = await complaintApi.startD2(c._id, { idempotencyKey: `d2-${crypto.randomUUID()}` });
                refreshed(res.data);
                setParams({ tab: 'D2' }, { replace: true });
                notify('D2 started. Record the verified product details and assign the First Responsible Person.');
              } catch (err) {
                notify(readError(err).message, 'bad');
              }
            },
            completeD2: () => setCompletingD2(true),
            submitD3: () => setSubmitting(true),
            resubmitD3: () => setSubmitting(true),
            approveD3: () => setDeciding('approve'),
            rejectD3: () => setDeciding('reject'),
            startD3: async () => {
              try {
                const res = await complaintApi.startD3(c._id, { idempotencyKey: `d3-${crypto.randomUUID()}` });
                refreshed(res.data);
                setParams({ tab: 'D3' }, { replace: true });
                notify('Analysis started. Choose Why-Why, Fishbone or both.');
              } catch (err) {
                notify(readError(err).message, 'bad');
              }
            },
          }}
            extraBlockers={
              c.status === 'D3_PENDING_APPROVAL' && !detail.can.reviewD3
                ? Object.fromEntries(['approveD3', 'rejectD3'].map((k) => [k,
                    detail.review?.submittedBy?._id === user._id
                      ? 'You submitted this analysis, so someone else must review it.'
                      : `Only ${detail.review?.reviewer?.name || 'the assigned reviewer'} can decide on this submission.`]))
                : {}
            } />
        </div>
      </header>

      {/* D2 SLA Extension Pop-up Modal (PDF Page 7) */}
      {extensionModal && (
        <Modal open title="Request D2 SLA Extension" onClose={() => setExtensionModal(false)}>
          <form onSubmit={handleRequestExtension} className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Extension Hours Requested <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="1"
                required
                placeholder="e.g. 52"
                value={extHours}
                onChange={(e) => setExtHours(e.target.value)}
                className="w-full rounded border border-slate-300 p-2.5 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Reason for Extension <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={3}
                required
                placeholder="e.g. testing only, laboratory analysis requires additional incubation..."
                value={extReason}
                onChange={(e) => setExtReason(e.target.value)}
                className="w-full rounded border border-slate-300 p-2.5 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <Button variant="secondary" onClick={() => setExtensionModal(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={savingExt || !extHours}>
                {savingExt ? 'Submitting...' : 'Submit Request'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="panel min-w-0">
          <div role="tablist" aria-label="Complaint sections" className="flex overflow-x-auto border-b border-line px-2">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                type="button"
                aria-selected={tab === t.key}
                onClick={() => setParams({ tab: t.key }, { replace: true })}
                className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 font-medium ${
                  tab === t.key ? 'border-brand text-brand' : 'border-transparent text-ink-muted hover:text-ink'
                }`}
              >
                {t.label}
                {t.key === 'files' && detail.attachmentCount > 0 && <span className="ml-1.5 text-sm text-ink-faint">{detail.attachmentCount}</span>}
                {t.key === c.stage && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-brand align-middle" aria-label="current stage" />}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="p-5">
            {tab === 'files' && <FilesTab complaint={c} canUpload={detail.can.upload} onChange={() => { load.reload(); setHistoryKey((k) => k + 1); }} />}
            {tab === 'D1' && <D1Tab detail={detail} onSaved={refreshed} refreshKey={historyKey} />}
            {tab === 'D2' && <D2Tab key={c.__v} detail={detail} onSaved={refreshed} refreshKey={historyKey} />}
            {tab === 'D3' && <D3Tab complaint={c} review={detail.review} refreshKey={historyKey} onChanged={() => setHistoryKey((k) => k + 1)} />}
            {tab === 'D4' && <D4Tab complaint={c} onRefresh={() => load.reload()} />}
            {tab === 'sla' && <SlaTab complaint={c} />}
          </div>
        </section>

        <aside className="space-y-5">
          <section className="panel">
            <h2 className="border-b border-line px-4 py-3 font-semibold">Assignment</h2>
            <dl className="space-y-3 px-4 py-3">
              <Item label="First Responsible Person" empty="Not assigned yet">{c.frp && <>{c.frp.name}{c.frp.designation && <span className="block text-sm text-ink-muted">{c.frp.designation}</span>}</>}</Item>
              <Item label="Priority" empty="Not set">{c.priority}</Item>
            </dl>
          </section>
          <HistoryPanel complaintId={c._id} refreshKey={historyKey} />
        </aside>
      </div>

      <ConfirmModal
        open={completingD2}
        title="Complete D2"
        description={`${c.complaintNumber}. D2 information is locked, and the D2 completion notice is emailed to ${c.frp ? c.frp.name : 'the First Responsible Person'}.`}
        confirmLabel="Complete D2 and notify"
        remarksLabel="Remarks"
        remarksHint="Optional. Recorded in the complaint history."
        onClose={() => setCompletingD2(false)}
        onConfirm={async (body) => {
          const res = await complaintApi.completeD2(c._id, body);
          setCompletingD2(false);
          refreshed(res.data);
          notify('D2 completed. The complaint is ready for root cause analysis.');
        }}
      />

      <SubmitD3Modal
        open={submitting}
        complaint={c}
        resubmit={c.status === 'D3_REWORK'}
        onClose={() => setSubmitting(false)}
        onDone={(next, reviewerName) => {
          setSubmitting(false);
          refreshed(next);
          setParams({ tab: 'D3' }, { replace: true });
          notify(`Submitted to ${reviewerName}. They have been emailed.`);
        }}
      />

      <ConfirmModal
        open={Boolean(deciding)}
        title={deciding === 'approve' ? 'Approve the analysis' : 'Reject and return for rework'}
        description={
          deciding === 'approve'
            ? `${c.complaintNumber}, version ${detail.review?.version}. The root causes and CAPA are approved.`
            : `${c.complaintNumber}, version ${detail.review?.version}. The First Responsible Person is emailed for each CAPA record and the analysis reopens for correction.`
        }
        confirmLabel={deciding === 'approve' ? 'Approve' : 'Reject and notify'}
        remarksLabel={deciding === 'approve' ? 'Remarks' : 'Rejection remarks (required)'}
        remarksHint={deciding === 'approve' ? 'Optional. Recorded in the review history.' : 'Explain what must be corrected. These remarks are included in the email.'}
        onClose={() => setDeciding(null)}
        onConfirm={async (body) => {
          const res = await (deciding === 'approve' ? d3Api.approve(c._id, body) : d3Api.reject(c._id, body));
          const was = deciding;
          setDeciding(null);
          refreshed(res.data);
          setParams({ tab: 'D3' }, { replace: true });
          notify(was === 'approve' ? 'Analysis approved.' : 'Analysis returned for rework. The First Responsible Person has been emailed.');
        }}
      />

      <AcknowledgeModal
        open={acking}
        complaint={c}
        onClose={() => setAcking(false)}
        onDone={(next, to) => {
          setAcking(false);
          refreshed(next);
          setParams({ tab: 'D1' }, { replace: true });
          notify(`Acknowledged. The acknowledgement email to ${to} is being sent.`);
          // Pick up the "Sent" status once the worker has delivered it.
          setTimeout(() => setHistoryKey((k) => k + 1), 2500);
        }}
      />
    </>
  );
}
