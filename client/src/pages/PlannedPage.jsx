import { PageHeader } from '../components/PageHeader.jsx';

const WHAT = {
  3: 'Complaint registration, the complaint list with search and filters, and the complaint detail page.',
  4: 'D1 acknowledgement, the acknowledgement email, and email delivery logs.',
  5: 'D2 product verification, preliminary investigation and First Responsible Person assignment.',
  6: 'D3 Why-Why analysis, the fishbone diagram, root cause records and CAPA.',
  8: 'D4 and closure, once the business rules for those stages are confirmed.',
  9: 'Reports calculated from live complaint data.',
};

export function PlannedPage({ title, phase }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="panel px-5 py-8">
        <p className="font-medium">This area is not available yet.</p>
        <p className="mt-1 max-w-xl text-ink-muted">It is scheduled for build phase {phase}: {WHAT[phase] || 'details in docs/IMPLEMENTATION_PLAN.md.'}</p>
      </div>
    </>
  );
}
