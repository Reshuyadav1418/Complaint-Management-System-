import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { readError } from '../api/client.js';
import { Field } from '../components/Field.jsx';
import { Button } from '../components/Button.jsx';
import { useToast } from '../components/Toast.jsx';

function rules(pw) {
  return [
    { ok: pw.length >= 10, text: 'At least 10 characters' },
    { ok: /[A-Za-z]/.test(pw) && /\d/.test(pw), text: 'At least one letter and one number' },
  ];
}

/** Used both for the forced first change and the voluntary change. */
export function ChangePasswordPage({ forced = false }) {
  const { changePassword, logout, user } = useAuth();
  const navigate = useNavigate();
  const notify = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const mismatch = form.confirm && form.confirm !== form.newPassword;

  const submit = async (e) => {
    e.preventDefault();
    if (form.newPassword !== form.confirm) {
      setError({ message: '', fields: { confirm: 'The two passwords do not match.' } });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changePassword(form.currentPassword, form.newPassword);
      notify('Password changed. Other devices have been signed out.');
      navigate('/', { replace: true });
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <form onSubmit={submit} className="panel space-y-4 p-6" noValidate>
      {error?.message && !Object.keys(error.fields).length && (
        <p className="rounded border border-bad/20 bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">{error.message}</p>
      )}
      <Field label={forced ? 'Temporary password' : 'Current password'} error={error?.fields.currentPassword}>
        {(p) => <input {...p} type="password" autoComplete="current-password" className="field-input" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />}
      </Field>
      <Field label="New password" error={error?.fields.newPassword}>
        {(p) => <input {...p} type="password" autoComplete="new-password" className="field-input" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />}
      </Field>
      <ul className="space-y-0.5 text-sm">
        {rules(form.newPassword).map((r) => (
          <li key={r.text} className={r.ok ? 'text-ok' : 'text-ink-muted'}>
            {r.ok ? '✓' : '·'} {r.text}
          </li>
        ))}
      </ul>
      <Field label="Confirm new password" error={error?.fields.confirm || (mismatch ? 'The two passwords do not match.' : null)}>
        {(p) => <input {...p} type="password" autoComplete="new-password" className="field-input" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />}
      </Field>
      <div className="flex items-center justify-between gap-3 pt-1">
        {forced ? (
          <Button variant="ghost" onClick={() => logout(false)}>Sign out</Button>
        ) : (
          <Button variant="ghost" onClick={() => navigate(-1)}>Cancel</Button>
        )}
        <Button type="submit" variant="primary" loading={busy}>Change password</Button>
      </div>
    </form>
  );

  if (!forced) {
    return (
      <div className="max-w-md">
        <h1 className="mb-1 text-xl font-semibold">Change password</h1>
        <p className="mb-5 text-ink-muted">Changing your password signs you out on your other devices.</p>
        {body}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-xl font-semibold">Set your password</h1>
        <p className="mb-5 text-ink-muted">
          Welcome, {user.name.split(' ')[0]}. Your account was set up with a temporary password. Choose your own before continuing.
        </p>
        {body}
      </div>
    </div>
  );
}
