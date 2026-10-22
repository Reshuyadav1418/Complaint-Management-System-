import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { visibleNav } from '../auth/navigation.js';
import { complaintApi } from '../api/endpoints.js';
import { useAsync } from '../lib/useAsync.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { Loading, ErrorState } from '../components/States.jsx';

// Names of the default roles. Custom roles fall back to their key.
const ROLE_NAMES = {
  admin: 'Administrator',
  quality_coordinator: 'Quality Coordinator',
  frp: 'First Responsible Person',
  reviewer: 'Reviewer / FRP Manager',
  employee: 'Employee',
};

/** Workflow buckets, in the order a complaint moves through them. */
const PIPELINE = [
  { key: 'awaitingAcknowledgement', label: 'Awaiting acknowledgement', stage: 'D1', status: 'SUBMITTED,D1_ACK_PENDING' },
  { key: 'awaitingAssignment', label: 'Awaiting FRP assignment', stage: 'D2', status: 'D1_ACKNOWLEDGED,D2_IN_PROGRESS' },
  { key: 'inInvestigation', label: 'In investigation', stage: 'D3', status: 'D2_COMPLETED,D3_IN_PROGRESS' },
  { key: 'pendingApproval', label: 'Pending D3 approval', stage: 'D3', status: 'D3_PENDING_APPROVAL' },
  { key: 'rework', label: 'Returned for rework', stage: 'D3', status: 'D3_REWORK', tone: 'bad' },
  { key: 'inD4', label: 'In D4', stage: 'D4', status: 'D3_APPROVED,D4_IN_PROGRESS' },
  { key: 'closed', label: 'Closed', stage: 'Done', status: 'CLOSED' },
];

function Pipeline({ s, canList }) {
  const Row = ({ to, children }) =>
    canList ? (
      <Link to={to} className="flex items-center gap-3 px-5 py-2.5 hover:bg-page">{children}</Link>
    ) : (
      <div className="flex items-center gap-3 px-5 py-2.5">{children}</div>
    );
  const max = Math.max(1, ...PIPELINE.map((p) => s[p.key]));

  return (
    <section className="panel mb-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
        <h2 className="font-semibold">Complaint pipeline</h2>
        <p className="text-sm text-ink-muted">
          {s.total} total, {s.total - s.closed} open, {s.newLast24h} new in the last 24 hours
        </p>
      </div>
      {s.total === 0 ? (
        <p className="px-5 py-6 text-ink-muted">No complaints yet. Counts appear here as soon as the first complaint is registered.</p>
      ) : (
        <ul className="divide-y divide-line">
          {PIPELINE.map((p) => (
            <li key={p.key}>
              <Row to={`/complaints?status=${p.status}`}>
                <span className="w-10 text-sm font-medium text-ink-faint">{p.stage}</span>
                <span className="w-56 shrink-0">{p.label}</span>
                <span className="hidden flex-1 sm:block" aria-hidden>
                  <span
                    className={`block h-2 rounded-sm ${p.tone === 'bad' && s[p.key] ? 'bg-bad/60' : 'bg-brand/50'}`}
                    style={{ width: `${(s[p.key] / max) * 100}%`, minWidth: s[p.key] ? '4px' : 0 }}
                  />
                </span>
                <span className={`ml-auto w-10 text-right font-semibold ${p.tone === 'bad' && s[p.key] ? 'text-bad' : ''}`}>{s[p.key]}</span>
              </Row>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-line px-5 py-2.5 text-sm text-ink-muted">
        Overdue complaints will be counted once SLA rules are configured.
      </p>
    </section>
  );
}

export function DashboardPage() {
  const { user, canAny } = useAuth();
  const canSee = canAny('complaint.view.all', 'complaint.view.assigned');
  const summary = useAsync(() => (canSee ? complaintApi.dashboard() : Promise.resolve({ data: null })), [canSee]);
  const destinations = visibleNav(canAny).filter((i) => i.to !== '/');
  const roleNames = user.roles.map((r) => ROLE_NAMES[r] || r.replace(/_/g, ' ')).join(', ');

  return (
    <>
      <PageHeader title="Dashboard" description={`${user.name}, ${roleNames}${user.department?.name ? ` in ${user.department.name}` : ''}.`} />

      {canSee &&
        (summary.loading && !summary.data ? (
          <div className="panel mb-5"><Loading label="Counting complaints" /></div>
        ) : summary.error ? (
          <div className="panel mb-5"><ErrorState message={summary.error} onRetry={summary.reload} /></div>
        ) : (
          summary.data && (
            <>
              {summary.data.assignedToMe > 0 && (
                <Link to="/my-complaints?open=true" className="panel mb-5 flex items-center justify-between px-5 py-3 hover:border-brand/40">
                  <span>
                    <span className="font-semibold">{summary.data.assignedToMe}</span> open complaint{summary.data.assignedToMe === 1 ? ' is' : 's are'} assigned to you.
                  </span>
                  <span className="font-medium text-brand">Open my complaints</span>
                </Link>
              )}
              <Pipeline s={summary.data} canList={canAny('complaint.view.all', 'complaint.view.assigned')} />
            </>
          )
        ))}

      <section className="panel">
        <h2 className="border-b border-line px-5 py-3 font-semibold">Your work areas</h2>
        <ul className="divide-y divide-line">
          {destinations.map((item) => (
            <li key={item.to}>
              <Link to={item.to} className="flex items-center gap-3 px-5 py-3 hover:bg-page">
                <item.icon className="h-4 w-4 text-ink-muted" aria-hidden />
                <span className="flex-1">{item.label}</span>
                {item.phase && <span className="text-sm text-ink-faint">Not yet available</span>}
              </Link>
            </li>
          ))}
          {destinations.length === 0 && <li className="px-5 py-4 text-ink-muted">No work areas are assigned to your role yet. Contact an administrator.</li>}
        </ul>
      </section>
    </>
  );
}
