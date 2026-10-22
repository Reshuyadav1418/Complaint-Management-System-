import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { readError } from '../api/client.js';
import { Field } from '../components/Field.jsx';
import { Button } from '../components/Button.jsx';

export function LoginPage() {
  const { login, notice } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(form.email.trim(), form.password);
    } catch (err) {
      setError(readError(err));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          <div className="leading-tight">
            <p className="font-semibold">SFA Complaint Management</p>
            <p className="text-sm text-ink-muted">Sign in with your company account</p>
          </div>
        </div>

        <form onSubmit={submit} className="panel space-y-4 p-6" noValidate>
          {notice && !error && <p className="rounded border border-warn/20 bg-warn-soft px-3 py-2 text-sm text-warn">{notice}</p>}
          {error && !Object.keys(error.fields).length && (
            <p className="rounded border border-bad/20 bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">{error.message}</p>
          )}
          <Field label="Email" error={error?.fields.email}>
            {(p) => (
              <input
                {...p}
                type="email"
                autoComplete="username"
                autoFocus
                className="field-input"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            )}
          </Field>
          <Field label="Password" error={error?.fields.password}>
            {(p) => (
              <input
                {...p}
                type="password"
                autoComplete="current-password"
                className="field-input"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" loading={busy} className="w-full">
            Sign in
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-ink-muted">Forgot your password? Ask an administrator to reset it.</p>
      </div>
    </div>
  );
}
