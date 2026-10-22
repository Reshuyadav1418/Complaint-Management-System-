import { Link } from 'react-router-dom';

export function NotFoundPage({ forbidden = false }) {
  return (
    <div className="py-16 text-center">
      <h1 className="text-xl font-semibold">{forbidden ? 'You do not have access to this page' : 'Page not found'}</h1>
      <p className="mt-1 text-ink-muted">
        {forbidden ? 'If you need access, ask an administrator to update your role.' : 'Check the address, or go back to the dashboard.'}
      </p>
      <Link to="/" className="mt-4 inline-block font-medium text-brand hover:underline">Go to dashboard</Link>
    </div>
  );
}
