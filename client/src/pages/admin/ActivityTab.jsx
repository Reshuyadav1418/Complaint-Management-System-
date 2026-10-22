import { useState } from 'react';
import { adminApi } from '../../api/endpoints.js';
import { useAsync } from '../../lib/useAsync.js';
import { formatDateTime } from '../../lib/format.js';
import { Pagination } from '../../components/Pagination.jsx';
import { Loading, ErrorState, EmptyState } from '../../components/States.jsx';

const ACTIONS = {
  'auth.login': 'Signed in',
  'auth.login.failed': 'Failed sign-in',
  'auth.lockout': 'Account locked after failed sign-ins',
  'auth.logout.all': 'Signed out on all devices',
  'auth.password.change': 'Changed own password',
  'user.create': 'Added user',
  'user.update': 'Edited user',
  'user.deactivate': 'Deactivated user',
  'user.reactivate': 'Reactivated user',
  'user.password.reset': 'Reset password',
  'role.permissions.update': 'Changed role permissions',
  'department.create': 'Added department',
  'department.update': 'Edited department',
};

const lowerFirst = (t) => t.charAt(0).toLowerCase() + t.slice(1);
const sentence = (e) => lowerFirst(e.summary || ACTIONS[e.action] || e.action);

function describeChange(entry) {
  if (!entry.after || !Object.keys(entry.after).length) return null;
  return Object.keys(entry.after)
    .map((k) => {
      const show = (v) => (Array.isArray(v) ? v.join(', ') || 'none' : v === undefined || v === null || v === '' ? 'empty' : String(v));
      return entry.before && k in entry.before ? `${k}: ${show(entry.before[k])} → ${show(entry.after[k])}` : `${k}: ${show(entry.after[k])}`;
    })
    .join('; ');
}

export function ActivityTab() {
  const [filter, setFilter] = useState({ entityType: '', page: 1 });
  const list = useAsync(() => adminApi.auditLogs({ entityType: filter.entityType || undefined, page: filter.page }), [filter.entityType, filter.page]);

  return (
    <div className="panel">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <select className="field-input w-auto" aria-label="Filter by record type" value={filter.entityType} onChange={(e) => setFilter({ entityType: e.target.value, page: 1 })}>
          <option value="">All records</option>
          <option value="User">Users and sign-ins</option>
          <option value="Role">Roles</option>
          <option value="Department">Departments</option>
        </select>
        <p className="text-sm text-ink-muted">Entries cannot be edited or deleted. Complaint history appears on each complaint.</p>
      </div>
      {list.loading && !list.data ? (
        <Loading label="Loading activity" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : list.data.length === 0 ? (
        <EmptyState title="No activity recorded yet" />
      ) : (
        <ol className="divide-y divide-line">
          {list.data.map((e) => {
            const change = describeChange(e);
            return (
              <li key={e._id} className="grid gap-x-4 px-4 py-2.5 sm:grid-cols-[11rem_1fr]">
                <time className="text-sm text-ink-muted" dateTime={e.at}>{formatDateTime(e.at)}</time>
                <div>
                  <p>
                    <span className="font-medium">{e.actorName || 'System'}</span> {sentence(e)}
                  </p>
                  {change && <p className="mt-0.5 break-words text-sm text-ink-muted">{change}</p>}
                  {e.ip && <p className="text-xs text-ink-faint">IP {e.ip}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <Pagination meta={list.meta} onPage={(page) => setFilter({ ...filter, page })} />
    </div>
  );
}
