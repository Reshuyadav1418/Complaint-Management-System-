import { useEffect, useState } from 'react';
import { Plus, Search, Copy } from 'lucide-react';
import { userApi, adminApi } from '../../api/endpoints.js';
import { readError } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useAsync, useDebounced } from '../../lib/useAsync.js';
import { formatDateTime } from '../../lib/format.js';
import { Button } from '../../components/Button.jsx';
import { Badge } from '../../components/Badge.jsx';
import { Field } from '../../components/Field.jsx';
import { Modal } from '../../components/Modal.jsx';
import { Pagination } from '../../components/Pagination.jsx';
import { Loading, ErrorState, EmptyState } from '../../components/States.jsx';
import { useToast } from '../../components/Toast.jsx';

const EMPTY = { name: '', email: '', employeeId: '', phone: '', designation: '', department: '', roles: [] };

function useReferenceData() {
  const [ref, setRef] = useState({ roles: [], departments: [] });
  useEffect(() => {
    Promise.all([adminApi.roles(), adminApi.departments()])
      .then(([r, d]) => setRef({ roles: r.data, departments: d.data }))
      .catch(() => {});
  }, []);
  return ref;
}

function UserForm({ value, onChange, errors, roles, departments, isEdit }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const toggleRole = (key) =>
    onChange({ ...value, roles: value.roles.includes(key) ? value.roles.filter((r) => r !== key) : [...value.roles, key] });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Full name" required error={errors.name} className="sm:col-span-2">
        {(p) => <input {...p} className="field-input" value={value.name} onChange={set('name')} autoComplete="off" />}
      </Field>
      <Field label="Work email" required error={errors.email} hint={isEdit ? 'Used to sign in.' : 'Used to sign in and for complaint notifications.'}>
        {(p) => <input {...p} type="email" className="field-input" value={value.email} onChange={set('email')} autoComplete="off" />}
      </Field>
      <Field label="Employee ID" error={errors.employeeId}>
        {(p) => <input {...p} className="field-input" value={value.employeeId} onChange={set('employeeId')} />}
      </Field>
      <Field label="Department" error={errors.department}>
        {(p) => (
          <select {...p} className="field-input" value={value.department} onChange={set('department')}>
            <option value="">Not set</option>
            {departments.map((d) => (
              <option key={d._id} value={d._id}>{d.name}</option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Designation" error={errors.designation}>
        {(p) => <input {...p} className="field-input" value={value.designation} onChange={set('designation')} />}
      </Field>
      <Field label="Phone" error={errors.phone} className="sm:col-span-2 sm:w-1/2 sm:pr-2">
        {(p) => <input {...p} type="tel" className="field-input" value={value.phone} onChange={set('phone')} />}
      </Field>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-sm font-medium">
          Roles<span className="ml-0.5 text-bad" aria-hidden>*</span>
        </legend>
        <div className="space-y-1.5 rounded border border-line p-3">
          {roles.map((r) => (
            <label key={r.key} className="flex cursor-pointer items-start gap-2.5">
              <input type="checkbox" className="mt-1 accent-brand" checked={value.roles.includes(r.key)} onChange={() => toggleRole(r.key)} />
              <span>
                <span className="font-medium">{r.name}</span>
                <span className="block text-sm text-ink-muted">{r.description}</span>
              </span>
            </label>
          ))}
        </div>
        {errors.roles && <p className="mt-1 text-sm text-bad">{errors.roles}</p>}
      </fieldset>
    </div>
  );
}

function clean(form) {
  const out = { ...form };
  for (const k of ['employeeId', 'phone', 'designation', 'department']) if (out[k] === '') out[k] = undefined;
  return out;
}

function TemporaryPassword({ open, info, onClose }) {
  const notify = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(info.password);
      notify('Password copied.');
    } catch {
      notify('Copy failed. Select the password and copy it manually.', 'bad');
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Temporary password"
      description={info && `Share this with ${info.name} through a secure channel. It is shown only once.`}
      footer={<Button variant="primary" onClick={onClose}>Done</Button>}
    >
      {info && (
        <>
          <div className="flex items-center gap-2 rounded border border-line bg-page px-3 py-2.5">
            <code className="flex-1 select-all break-all text-lg tracking-wide">{info.password}</code>
            <Button size="sm" icon={Copy} onClick={copy}>Copy</Button>
          </div>
          <p className="mt-3 text-sm text-ink-muted">They will be asked to choose their own password the first time they sign in.</p>
        </>
      )}
    </Modal>
  );
}

export function UsersTab() {
  const { user: me } = useAuth();
  const notify = useToast();
  const { roles, departments } = useReferenceData();
  const roleName = (key) => roles.find((r) => r.key === key)?.name || key;

  const [filters, setFilters] = useState({ search: '', role: '', status: 'active', page: 1 });
  const search = useDebounced(filters.search);
  const list = useAsync(
    () => userApi.list({ search: search || undefined, role: filters.role || undefined, status: filters.status, page: filters.page }),
    [search, filters.role, filters.status, filters.page],
  );

  const [editing, setEditing] = useState(null); // null | 'new' | user
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [temp, setTemp] = useState(null);

  const openNew = () => {
    setForm(EMPTY);
    setErrors({});
    setFormError(null);
    setEditing('new');
  };
  const openEdit = (u) => {
    setForm({
      name: u.name,
      email: u.email,
      employeeId: u.employeeId || '',
      phone: u.phone || '',
      designation: u.designation || '',
      department: u.department?._id || '',
      roles: u.roles,
    });
    setErrors({});
    setFormError(null);
    setEditing(u);
  };
  const close = () => setEditing(null);

  const handle = async (kind, fn) => {
    setBusy(kind);
    setErrors({});
    setFormError(null);
    try {
      await fn();
    } catch (err) {
      const e = readError(err);
      setErrors(e.fields);
      if (!Object.keys(e.fields).length) setFormError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    handle('save', async () => {
      if (editing === 'new') {
        const res = await userApi.create(clean(form));
        close();
        list.reload();
        setTemp({ name: res.data.user.name, password: res.data.temporaryPassword });
      } else {
        await userApi.update(editing._id, clean(form));
        close();
        list.reload();
        notify('Changes saved.');
      }
    });

  const toggleActive = () =>
    handle('active', async () => {
      await userApi.update(editing._id, { isActive: !editing.isActive });
      notify(editing.isActive ? `${editing.name} can no longer sign in.` : `${editing.name} can sign in again.`);
      close();
      list.reload();
    });

  const reset = () =>
    handle('reset', async () => {
      const res = await userApi.resetPassword(editing._id);
      const name = editing.name;
      close();
      setTemp({ name, password: res.data.temporaryPassword });
    });

  const isSelf = editing && editing !== 'new' && editing._id === me._id;

  return (
    <div className="panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
          <input
            className="field-input pl-8"
            placeholder="Search name, email or employee ID"
            aria-label="Search users"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value, page: 1 })}
          />
        </div>
        <select className="field-input w-auto" aria-label="Filter by role" value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value, page: 1 })}>
          <option value="">All roles</option>
          {roles.map((r) => (
            <option key={r.key} value={r.key}>{r.name}</option>
          ))}
        </select>
        <select className="field-input w-auto" aria-label="Filter by status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value, page: 1 })}>
          <option value="active">Active</option>
          <option value="inactive">Deactivated</option>
          <option value="all">All</option>
        </select>
        <Button variant="primary" icon={Plus} onClick={openNew}>Add user</Button>
      </div>

      {list.loading && !list.data ? (
        <Loading label="Loading users" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : list.data.length === 0 ? (
        <EmptyState title={filters.search || filters.role ? 'No users match these filters' : 'No users yet'}>
          {filters.search || filters.role ? 'Clear the search or choose a different role.' : 'Add the people who will handle complaints.'}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className={`w-full text-left ${list.loading ? 'opacity-60' : ''}`}>
            <thead className="border-b border-line bg-page/60 text-sm text-ink-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Name</th>
                <th scope="col" className="px-4 py-2 font-medium">Employee ID</th>
                <th scope="col" className="px-4 py-2 font-medium">Department</th>
                <th scope="col" className="px-4 py-2 font-medium">Roles</th>
                <th scope="col" className="px-4 py-2 font-medium">Last sign-in</th>
                <th scope="col" className="px-4 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.data.map((u) => (
                <tr key={u._id} className="hover:bg-page/50">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{u.name}</span>
                      {!u.isActive && <Badge tone="bad">Deactivated</Badge>}
                      {u.isActive && u.mustChangePassword && <Badge tone="warn">Password not set</Badge>}
                    </div>
                    <div className="text-sm text-ink-muted">{u.email}</div>
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted">{u.employeeId || '—'}</td>
                  <td className="px-4 py-2.5">{u.department?.name || <span className="text-ink-faint">—</span>}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((r) => (
                        <Badge key={r} tone={r === 'admin' ? 'brand' : 'neutral'}>{roleName(r)}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-sm text-ink-muted">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(u)}>Edit</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination meta={list.meta} onPage={(page) => setFilters({ ...filters, page })} />

      <Modal
        open={Boolean(editing)}
        onClose={close}
        width="max-w-2xl"
        title={editing === 'new' ? 'Add user' : `Edit ${editing?.name || ''}`}
        description={editing === 'new' ? 'A temporary password is generated. They choose their own at first sign-in.' : null}
        footer={
          <>
            {editing && editing !== 'new' && !isSelf && (
              <div className="mr-auto flex gap-2">
                <Button variant="danger" loading={busy === 'active'} onClick={toggleActive}>
                  {editing.isActive ? 'Deactivate' : 'Reactivate'}
                </Button>
                {editing.isActive && <Button loading={busy === 'reset'} onClick={reset}>Reset password</Button>}
              </div>
            )}
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button variant="primary" loading={busy === 'save'} onClick={save}>
              {editing === 'new' ? 'Add user' : 'Save changes'}
            </Button>
          </>
        }
      >
        {formError && <p className="mb-4 rounded border border-bad/20 bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">{formError}</p>}
        {editing && <UserForm value={form} onChange={setForm} errors={errors} roles={roles} departments={departments} isEdit={editing !== 'new'} />}
      </Modal>

      <TemporaryPassword open={Boolean(temp)} info={temp} onClose={() => setTemp(null)} />
    </div>
  );
}
