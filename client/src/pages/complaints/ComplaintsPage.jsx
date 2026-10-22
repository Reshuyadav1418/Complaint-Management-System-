import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, ArrowUp, ArrowDown } from 'lucide-react';
import { complaintApi, adminApi } from '../../api/endpoints.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useAsync, useDebounced } from '../../lib/useAsync.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Button } from '../../components/Button.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { Pagination } from '../../components/Pagination.jsx';
import { Loading, ErrorState, EmptyState } from '../../components/States.jsx';
import { NewComplaintModal } from './NewComplaintModal.jsx';

const COLUMNS = [
  { key: 'number', label: 'Complaint', sortable: true },
  { key: 'date', label: 'Date', sortable: true },
  { key: 'requester', label: 'Requester' },
  { key: 'sbu', label: 'SBU / country', sortable: true },
  { key: 'product', label: 'Product' },
  { key: 'description', label: 'Description' },
  { key: 'status', label: 'Stage and status', sortable: true },
  { key: 'frp', label: 'Assigned to' },
  { key: 'updated', label: 'Last updated', sortable: true },
];

const FILTER_KEYS = ['search', 'status', 'stage', 'sbu', 'country', 'open', 'overdue'];

/**
 * Filters live in the URL, so a filtered list can be bookmarked or shared
 * and dashboard tiles can link straight to it.
 */
export function ComplaintsPage({ mine = false }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const get = (k, d = '') => params.get(k) || d;
  const set = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === '' || v == null) next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const [searchText, setSearchText] = useState(get('search'));
  const search = useDebounced(searchText);
  useEffect(() => {
    if (search !== get('search')) set({ search });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const query = useMemo(() => {
    const q = { sort: get('sort', 'updated'), order: get('order', 'desc'), page: get('page', '1'), limit: 20 };
    for (const k of FILTER_KEYS) if (params.get(k)) q[k] = params.get(k);
    if (mine) q.mine = 'true';
    return q;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, mine]);

  const list = useAsync(() => complaintApi.list(query), [JSON.stringify(query)]);
  const [options, setOptions] = useState({ sbus: [], countries: [], statuses: [] });
  useEffect(() => {
    Promise.all([complaintApi.filters(), adminApi.meta()])
      .then(([f, m]) => setOptions({ ...f.data, statuses: m.data.statuses }))
      .catch(() => {});
  }, []);

  const [creating, setCreating] = useState(false);
  const hasFilters = FILTER_KEYS.some((k) => params.get(k));
  const canCreate = !mine && can('complaint.create.manual');

  const sortBy = (key) => {
    if (query.sort === key) set({ order: query.order === 'asc' ? 'desc' : 'asc' });
    else set({ sort: key, order: key === 'number' ? 'asc' : 'desc' });
  };

  const empty = hasFilters ? (
    <EmptyState title="No complaints match these filters">Clear the filters or change the search to see more.</EmptyState>
  ) : mine ? (
    <EmptyState title="Nothing is assigned to you">Complaints appear here when a Quality Coordinator makes you the First Responsible Person.</EmptyState>
  ) : (
    <EmptyState
      title="No complaints registered yet"
      action={canCreate && <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Register complaint</Button>}
    >
      Complaints arrive here from WhatsApp, or can be registered by staff.
    </EmptyState>
  );

  return (
    <>
      <PageHeader
        title={mine ? 'My assigned complaints' : 'Complaints'}
        description={mine ? 'Complaints where you are the First Responsible Person or hold an active assignment.' : null}
        actions={canCreate && <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Register complaint</Button>}
      />

      <div className="panel">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="relative min-w-[16rem] flex-[2]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <input
              className="field-input pl-8"
              placeholder="Search number, requester, product, batch or description"
              aria-label="Search complaints"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>
          <select className="field-input w-auto" aria-label="Status" value={get('status')} onChange={(e) => set({ status: e.target.value })}>
            <option value="">All statuses</option>
            {options.statuses.map((s) => (
              <option key={s.key} value={s.key}>{s.stage === 'CLOSED' ? s.label : `${s.stage}: ${s.label}`}</option>
            ))}
          </select>
          <select className="field-input w-auto" aria-label="SBU" value={get('sbu')} onChange={(e) => set({ sbu: e.target.value })}>
            <option value="">All SBUs</option>
            {options.sbus.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select className="field-input w-auto" aria-label="Country" value={get('country')} onChange={(e) => set({ country: e.target.value })}>
            <option value="">All countries</option>
            {options.countries.map((s) => <option key={s}>{s}</option>)}
          </select>
          <label className="flex items-center gap-1.5 whitespace-nowrap px-1 text-ink-muted">
            <input type="checkbox" className="accent-brand" checked={get('open') === 'true'} onChange={(e) => set({ open: e.target.checked ? 'true' : '' })} />
            Open only
          </label>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchText('');
                setParams({}, { replace: true });
              }}
            >
              Clear filters
            </Button>
          )}
        </div>

        {list.loading && !list.data ? (
          <Loading label="Loading complaints" />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : list.data.length === 0 ? (
          empty
        ) : (
          <div className="overflow-x-auto">
            <table className={`w-full min-w-[76rem] text-left ${list.loading ? 'opacity-60' : ''}`}>
              <thead className="border-b border-line bg-page/60 text-sm text-ink-muted">
                <tr>
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      scope="col"
                      className="whitespace-nowrap px-3 py-2 font-medium first:pl-4"
                      aria-sort={query.sort === col.key ? (query.order === 'asc' ? 'ascending' : 'descending') : undefined}
                    >
                      {col.sortable ? (
                        <button type="button" onClick={() => sortBy(col.key)} className="inline-flex items-center gap-1 hover:text-ink">
                          {col.label}
                          {query.sort === col.key && (query.order === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />)}
                        </button>
                      ) : (
                        col.label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.data.map((c) => (
                  <tr key={c._id} className="cursor-pointer align-top hover:bg-page/60" onClick={() => navigate(`/complaints/${c._id}`)}>
                    <td className="whitespace-nowrap py-2.5 pl-4 pr-3">
                      <Link to={`/complaints/${c._id}`} className="font-medium text-brand hover:underline" onClick={(e) => e.stopPropagation()}>
                        {c.complaintNumber}
                      </Link>
                      <div className="text-xs text-ink-faint">{c.origin}</div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">{formatDate(c.complaintDate)}</td>
                    <td className="min-w-[9rem] px-3 py-2.5">{c.requester?.name}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      {c.sbu}
                      <div className="text-sm text-ink-muted">{c.country}</div>
                    </td>
                    <td className="px-3 py-2.5">{c.d2?.verifiedProduct?.productName || c.reportedProduct?.name || <span className="text-ink-faint">—</span>}</td>
                    <td className="min-w-[15rem] max-w-[22rem] px-3 py-2.5">
                      <p className="line-clamp-2">{c.shortDescription}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="mb-1 text-xs font-medium text-ink-muted">{c.stage === 'CLOSED' ? 'Closed' : c.stage}</div>
                      <StatusBadge status={c.status} label={c.statusLabel} />
                    </td>
                    <td className="px-3 py-2.5">{c.frp?.name || <span className="text-ink-faint">Unassigned</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-sm text-ink-muted">{formatDateTime(c.lastActivityAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination meta={list.meta} onPage={(page) => set({ page: String(page) })} />
      </div>

      <NewComplaintModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(c) => {
          setCreating(false);
          navigate(`/complaints/${c._id}`);
        }}
      />
    </>
  );
}
