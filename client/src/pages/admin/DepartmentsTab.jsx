import { useState } from 'react';
import { Plus } from 'lucide-react';
import { adminApi } from '../../api/endpoints.js';
import { readError } from '../../api/client.js';
import { useAsync } from '../../lib/useAsync.js';
import { Button } from '../../components/Button.jsx';
import { Badge } from '../../components/Badge.jsx';
import { Field } from '../../components/Field.jsx';
import { Modal } from '../../components/Modal.jsx';
import { Loading, ErrorState, EmptyState } from '../../components/States.jsx';
import { useToast } from '../../components/Toast.jsx';

export function DepartmentsTab() {
  const notify = useToast();
  const list = useAsync(() => adminApi.departments(true), []);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', code: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const open = (d) => {
    setEditing(d || 'new');
    setForm(d ? { name: d.name, code: d.code } : { name: '', code: '' });
    setErrors({});
  };

  const run = async (fn, message) => {
    setBusy(true);
    setErrors({});
    try {
      await fn();
      notify(message);
      setEditing(null);
      list.reload();
    } catch (err) {
      const e = readError(err);
      setErrors(Object.keys(e.fields).length ? e.fields : { _: e.message });
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    editing === 'new'
      ? run(() => adminApi.createDepartment(form), `${form.name} added.`)
      : run(() => adminApi.updateDepartment(editing._id, form), 'Changes saved.');

  const toggle = () =>
    run(
      () => adminApi.updateDepartment(editing._id, { isActive: !editing.isActive }),
      editing.isActive ? `${editing.name} deactivated.` : `${editing.name} reactivated.`,
    );

  return (
    <div className="panel">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <p className="text-ink-muted">Deactivated departments stay on existing records but cannot be chosen for new users.</p>
        <Button variant="primary" icon={Plus} onClick={() => open(null)}>Add department</Button>
      </div>
      {list.loading && !list.data ? (
        <Loading label="Loading departments" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : list.data.length === 0 ? (
        <EmptyState title="No departments yet">Add departments so users can be grouped and complaints routed to the right team.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b border-line bg-page/60 text-sm text-ink-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Department</th>
                <th scope="col" className="px-4 py-2 font-medium">Code</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Active users</th>
                <th scope="col" className="px-4 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.data.map((d) => (
                <tr key={d._id} className="hover:bg-page/50">
                  <td className="px-4 py-2.5">
                    <span className="font-medium">{d.name}</span> {!d.isActive && <Badge tone="bad">Deactivated</Badge>}
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted">{d.code}</td>
                  <td className="px-4 py-2.5 text-right">{d.activeUsers}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Button size="sm" variant="ghost" onClick={() => open(d)}>Edit</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add department' : 'Edit department'}
        footer={
          <>
            {editing && editing !== 'new' && (
              <Button variant="danger" className="mr-auto" loading={busy} onClick={toggle}>
                {editing.isActive ? 'Deactivate' : 'Reactivate'}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={save}>{editing === 'new' ? 'Add department' : 'Save changes'}</Button>
          </>
        }
      >
        {errors._ && <p className="mb-4 rounded border border-bad/20 bg-bad-soft px-3 py-2 text-sm text-bad">{errors._}</p>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name" required error={errors.name} className="sm:col-span-2">
            {(p) => <input {...p} className="field-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
          </Field>
          <Field label="Code" required error={errors.code} hint="e.g. QA">
            {(p) => <input {...p} className="field-input uppercase" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />}
          </Field>
        </div>
      </Modal>
    </div>
  );
}
