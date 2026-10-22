import { useEffect, useMemo, useState } from 'react';
import { adminApi } from '../../api/endpoints.js';
import { readError } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Button } from '../../components/Button.jsx';
import { Loading, ErrorState } from '../../components/States.jsx';
import { useToast } from '../../components/Toast.jsx';

const GROUPS = [
  { title: 'Complaints', match: (p) => p.startsWith('complaint.') || p.startsWith('attachment.') },
  { title: 'Oversight', match: (p) => ['reports.view', 'audit.view', 'notifications.view', 'notifications.retry'].includes(p) },
  { title: 'Administration', match: (p) => ['users.manage', 'roles.manage', 'departments.manage', 'settings.manage'].includes(p) },
];

export function RolesTab() {
  const { can } = useAuth();
  const editable = can('roles.manage');
  const notify = useToast();
  const [state, setState] = useState({ loading: true, error: null, roles: [], labels: {} });
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  const load = () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    adminApi
      .roles()
      .then((res) => {
        setState({ loading: false, error: null, roles: res.data, labels: res.meta.permissionLabels });
        setDraft(Object.fromEntries(res.data.map((r) => [r.key, new Set(r.permissions)])));
      })
      .catch((err) => setState((s) => ({ ...s, loading: false, error: readError(err).message })));
  };
  useEffect(load, []);

  const changed = useMemo(
    () =>
      state.roles.filter((r) => {
        const d = draft[r.key];
        return d && (d.size !== r.permissions.length || r.permissions.some((p) => !d.has(p)));
      }),
    [state.roles, draft],
  );

  const toggle = (roleKey, perm) => {
    setDraft((d) => {
      const next = new Set(d[roleKey]);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      return { ...d, [roleKey]: next };
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      for (const r of changed) await adminApi.updateRole(r.key, [...draft[r.key]]);
      notify(`Permissions updated for ${changed.map((r) => r.name).join(', ')}. Changes apply within 30 seconds.`);
      load();
    } catch (err) {
      notify(readError(err).message, 'bad');
    } finally {
      setSaving(false);
    }
  };

  if (state.loading && !state.roles.length) return <div className="panel"><Loading label="Loading roles" /></div>;
  if (state.error) return <div className="panel"><ErrorState message={state.error} onRetry={load} /></div>;

  const perms = Object.keys(state.labels);

  return (
    <div className="panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <p className="max-w-2xl text-ink-muted">
          {editable
            ? 'The server checks these permissions on every request. Items marked "rules pending" have no effect until those stages are built.'
            : 'You can view role permissions. Only administrators can change them.'}
        </p>
        {editable && (
          <div className="flex gap-2">
            <Button variant="ghost" disabled={!changed.length || saving} onClick={load}>Discard</Button>
            <Button variant="primary" disabled={!changed.length} loading={saving} onClick={save}>
              Save changes{changed.length ? ` (${changed.length})` : ''}
            </Button>
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="border-b border-line bg-page/60 text-sm">
            <tr>
              <th scope="col" className="sticky left-0 bg-page px-4 py-2 font-medium text-ink-muted">Permission</th>
              {state.roles.map((r) => (
                <th key={r.key} scope="col" className="min-w-[7.5rem] px-3 py-2 text-center font-medium" title={r.description}>
                  {r.name}
                </th>
              ))}
            </tr>
          </thead>
          {GROUPS.map((g) => (
            <tbody key={g.title} className="divide-y divide-line border-b border-line">
              <tr>
                <th colSpan={state.roles.length + 1} scope="colgroup" className="bg-surface px-4 pb-1 pt-3 text-sm font-semibold">
                  {g.title}
                </th>
              </tr>
              {perms.filter(g.match).map((p) => (
                <tr key={p} className="hover:bg-page/50">
                  <th scope="row" className="sticky left-0 bg-surface px-4 py-2 font-normal">{state.labels[p]}</th>
                  {state.roles.map((r) => {
                    const locked = r.key === 'admin' && p === 'roles.manage';
                    return (
                      <td key={r.key} className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-brand disabled:opacity-50"
                          checked={draft[r.key]?.has(p) || false}
                          disabled={!editable || locked}
                          onChange={() => toggle(r.key, p)}
                          aria-label={`${r.name}: ${state.labels[p]}`}
                          title={locked ? 'Administrators always keep this so access can be recovered.' : undefined}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}
