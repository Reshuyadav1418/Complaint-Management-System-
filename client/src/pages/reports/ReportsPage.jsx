import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { reportApi, complaintApi } from '../../api/endpoints.js';
import { useAsync } from '../../lib/useAsync.js';
import { formatDate } from '../../lib/format.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Loading, ErrorState } from '../../components/States.jsx';

const ACTION = { NOT_STARTED: 'Not started', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', VERIFIED: 'Verified', NOT_REQUIRED: 'Not required' };
const APPROVAL = { PENDING: 'Approval pending', APPROVED: 'Approved', REJECTED: 'Rejected' };

function Panel({ title, note, children, className = '' }) {
  return (
    <section className={`panel ${className}`}>
      <div className="border-b border-line px-4 py-2.5">
        <h2 className="font-semibold">{title}</h2>
        {note && <p className="text-sm text-ink-muted">{note}</p>}
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

/** Horizontal bars; each row shows its count and share of the total. */
function Bars({ rows, empty = 'No data for these filters.' }) {
  const total = rows.reduce((n, r) => n + r.count, 0);
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length || total === 0) return <p className="py-2 text-ink-muted">{empty}</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(7rem,11rem)_1fr_4.5rem] items-center gap-3">
          <span className="truncate" title={r.label}>{r.label}</span>
          <span className="h-2.5 rounded-sm bg-page" aria-hidden>
            <span className="block h-full rounded-sm bg-brand/60" style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <span className="text-right"><span className="font-semibold">{r.count}</span> <span className="text-sm text-ink-faint">{Math.round((r.count / total) * 100)}%</span></span>
        </li>
      ))}
    </ul>
  );
}

function Monthly({ rows }) {
  if (!rows.length) return <p className="py-2 text-ink-muted">No data for these filters.</p>;
  const max = Math.max(1, ...rows.map((r) => r.count));
  const label = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  return (
    <div className="flex h-40 items-end gap-2 overflow-x-auto pb-1">
      {rows.map((r) => (
        <div key={r.month} className="flex min-w-[2.75rem] flex-1 flex-col items-center gap-1">
          <span className="text-sm font-semibold">{r.count}</span>
          <span className="w-full max-w-[3rem] rounded-t-sm bg-brand/60" style={{ height: `${Math.max(4, (r.count / max) * 100)}px` }} />
          <span className="text-xs text-ink-muted">{label(r.month)}</span>
        </div>
      ))}
    </div>
  );
}

export function ReportsPage() {
  const [filters, setFilters] = useState({ from: '', to: '', sbu: '', country: '' });
  const params = {
    from: filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : undefined,
    to: filters.to ? new Date(`${filters.to}T23:59:59`).toISOString() : undefined,
    sbu: filters.sbu || undefined,
    country: filters.country || undefined,
  };
  const report = useAsync(() => reportApi.summary(params), [JSON.stringify(params)]);
  const [options, setOptions] = useState({ sbus: [], countries: [] });
  useEffect(() => { complaintApi.filters().then((r) => setOptions(r.data)).catch(() => {}); }, []);
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });
  const r = report.data;

  return (
    <>
      <PageHeader
        title="Reports"
        description="Calculated from live complaint records you are allowed to see."
        actions={
          <a href={reportApi.csvUrl(params)} className="inline-flex items-center gap-2 rounded border border-line-strong bg-surface px-3.5 py-1.5 font-medium hover:bg-page">
            <Download className="h-4 w-4" aria-hidden /> Export complaints (CSV)
          </a>
        }
      />
      <div className="panel mb-5 flex flex-wrap items-end gap-3 px-4 py-3">
        <label className="text-sm">From<input type="date" className="field-input mt-1" value={filters.from} onChange={set('from')} /></label>
        <label className="text-sm">To<input type="date" className="field-input mt-1" value={filters.to} onChange={set('to')} /></label>
        <label className="text-sm">SBU
          <select className="field-input mt-1" value={filters.sbu} onChange={set('sbu')}><option value="">All</option>{options.sbus.map((s) => <option key={s}>{s}</option>)}</select>
        </label>
        <label className="text-sm">Country
          <select className="field-input mt-1" value={filters.country} onChange={set('country')}><option value="">All</option>{options.countries.map((s) => <option key={s}>{s}</option>)}</select>
        </label>
        {Object.values(filters).some(Boolean) && <button type="button" className="pb-2 text-sm font-medium text-brand hover:underline" onClick={() => setFilters({ from: '', to: '', sbu: '', country: '' })}>Clear</button>}
      </div>

      {report.loading && !r ? (
        <div className="panel"><Loading label="Calculating" /></div>
      ) : report.error ? (
        <div className="panel"><ErrorState message={report.error} onRetry={report.reload} /></div>
      ) : (
        <div className={`space-y-5 ${report.loading ? 'opacity-60' : ''}`}>
          <section className="panel grid grid-cols-2 divide-line sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">
            {[
              ['Complaints', r.total],
              ['Open', r.openVsClosed.open],
              ['Closed', r.openVsClosed.closed],
              ['Avg. resolution', r.resolution.averageDays === null ? '—' : `${r.resolution.averageDays} days`, r.resolution.closedCount ? `${r.resolution.closedCount} closed` : 'none closed yet'],
              ['Avg. to acknowledge', r.acknowledgement.averageHours === null ? '—' : `${r.acknowledgement.averageHours} h`, `${r.acknowledgement.acknowledgedCount} acknowledged`],
              ['Overdue CAPA', r.capa.overdue],
            ].map(([label, value, sub]) => (
              <div key={label} className="px-4 py-3">
                <p className="text-sm text-ink-muted">{label}</p>
                <p className={`text-xl font-semibold ${label === 'Overdue CAPA' && value > 0 ? 'text-bad' : ''}`}>{value}</p>
                {sub && <p className="text-xs text-ink-faint">{sub}</p>}
              </div>
            ))}
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="Complaints by category"><Bars rows={r.byCategory} /></Panel>
            <Panel title="Complaints by month"><Monthly rows={r.monthly} /></Panel>
            <Panel title="Complaint source"><Bars rows={r.bySource} /></Panel>
            <Panel title="Current status"><Bars rows={r.byStatus} /></Panel>
            <Panel title="Root cause categories" note="Recorded root causes in D3."><Bars rows={r.rootCauseCategories} empty="No root causes recorded yet." /></Panel>
            <Panel title="CAPA status" note="Action progress and approval are tracked separately.">
              <div className="space-y-4">
                <div><p className="mb-1.5 text-sm font-medium">Action</p><Bars rows={Object.entries(r.capa.byAction).map(([k, v]) => ({ label: ACTION[k] || k, count: v }))} empty="No CAPA yet." /></div>
                <div><p className="mb-1.5 text-sm font-medium">Approval</p><Bars rows={Object.entries(r.capa.byApproval).map(([k, v]) => ({ label: APPROVAL[k] || k, count: v }))} empty="No CAPA yet." /></div>
              </div>
            </Panel>
          </div>

          <Panel title="Workload by First Responsible Person">
            {r.workload.length === 0 ? <p className="text-ink-muted">No complaints have an FRP yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="text-sm text-ink-muted"><tr className="border-b border-line"><th className="py-1.5 font-medium">FRP</th><th className="py-1.5 text-right font-medium">Open</th><th className="py-1.5 text-right font-medium">In rework</th><th className="py-1.5 text-right font-medium">Closed</th></tr></thead>
                  <tbody className="divide-y divide-line">{r.workload.map((w) => <tr key={w.name}><td className="py-2">{w.name}</td><td className="py-2 text-right font-semibold">{w.open}</td><td className="py-2 text-right">{w.inRework}</td><td className="py-2 text-right">{w.closed}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Overdue CAPA" note="Target date passed and action not completed, verified or marked not required.">
            {r.capa.overdueList.length === 0 ? <p className="text-ink-muted">Nothing is overdue.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="text-sm text-ink-muted"><tr className="border-b border-line"><th className="py-1.5 font-medium">CAPA</th><th className="py-1.5 font-medium">Responsible</th><th className="py-1.5 font-medium">Target date</th><th className="py-1.5 font-medium">Action</th></tr></thead>
                  <tbody className="divide-y divide-line">{r.capa.overdueList.map((c) => (
                    <tr key={c.capaNumber}><td className="py-2"><Link className="font-medium text-brand hover:underline" to={`/complaints/${c.complaintId}?tab=D3`}>{c.capaNumber}</Link></td><td className="py-2">{c.responsible}</td><td className="py-2 text-bad">{formatDate(c.targetDate)}</td><td className="py-2">{ACTION[c.actionStatus]}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="SLA and escalation"><p className="text-ink-muted">{r.sla.note}</p></Panel>
        </div>
      )}
    </>
  );
}
