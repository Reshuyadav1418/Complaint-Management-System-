import { Link } from 'react-router-dom';
import { complaintApi } from '../../api/endpoints.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useAsync } from '../../lib/useAsync.js';
import { formatDate } from '../../lib/format.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Loading, ErrorState } from '../../components/States.jsx';

function Queue({ title, description, status, empty, mine }) {
  const list = useAsync(() => complaintApi.list({ status, mine: mine ? 'true' : undefined, sort: 'date', order: 'asc', limit: 50 }), [status, mine]);
  return (
    <section className="panel mb-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-sm text-ink-muted">{description}</p>
        </div>
        {list.meta && <span className="text-sm text-ink-muted">{list.meta.total} waiting, oldest first</span>}
      </div>
      {list.loading && !list.data ? (
        <Loading />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : list.data.length === 0 ? (
        <p className="px-5 py-5 text-ink-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.data.map((c) => (
            <li key={c._id}>
              <Link to={`/complaints/${c._id}`} className="grid gap-x-4 px-5 py-3 hover:bg-page sm:grid-cols-[10rem_7rem_1fr_10rem]">
                <span className="font-medium text-brand">{c.complaintNumber}</span>
                <span className="text-sm text-ink-muted">{formatDate(c.complaintDate)}</span>
                <span className="min-w-0 truncate">{c.shortDescription}</span>
                <span className="truncate text-sm text-ink-muted">{c.requester?.name}, {c.country}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PendingReviewsPage() {
  const { can } = useAuth();
  return (
    <>
      <PageHeader title="Pending reviews" description="Complaints waiting for a decision from you." />
      {can('complaint.d1.acknowledge') && (
        <Queue
          title="D1 acknowledgement"
          description="Check the complaint details, then approve the acknowledgement to email the requester."
          status="SUBMITTED,D1_ACK_PENDING"
          empty="No complaints are waiting for acknowledgement."
        />
      )}
      {can('complaint.d3.review') && (
        <Queue
          title="D3 root cause and CAPA approval"
          description="Analyses submitted to you. Approve them, or return them for rework with remarks."
          status="D3_PENDING_APPROVAL"
          mine
          empty="No analyses are waiting for your approval."
        />
      )}
    </>
  );
}
