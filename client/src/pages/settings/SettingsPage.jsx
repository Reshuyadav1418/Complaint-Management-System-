import { useState } from 'react';
import { Plus } from 'lucide-react';
import { lookupApi } from '../../api/endpoints.js';
import { readError } from '../../api/client.js';
import { useAsync } from '../../lib/useAsync.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Button } from '../../components/Button.jsx';
import { Badge } from '../../components/Badge.jsx';
import { Loading, ErrorState } from '../../components/States.jsx';
import { useToast } from '../../components/Toast.jsx';

/** One editable list. Location details are grouped under their location. */
function ListEditor({ listKey, definition, rows, parents, onChange }) {
  const notify = useToast();
  const [value, setValue] = useState('');
  const [parent, setParent] = useState('');
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const needsParent = Boolean(definition.parentList);

  const run = async (fn, ok) => {
    setError(null);
    try {
      await fn();
      notify(ok);
      onChange();
      return true;
    } catch (err) {
      const e = readError(err);
      setError(Object.values(e.fields)[0] || e.message);
      return false;
    }
  };

  const add = async (e) => {
    e.preventDefault();
    if (await run(() => lookupApi.create({ list: listKey, value, parent: needsParent ? parent : undefined }), `“${value}” added.`)) setValue('');
  };

  const groups = needsParent ? parents.map((p) => [p.value, rows.filter((r) => r.parent === p.value)]) : [[null, rows]];

  return (
    <section className="panel">
      <div className="border-b border-line px-5 py-3">
        <h2 className="font-semibold">{definition.label}</h2>
        <p className="text-sm text-ink-muted">
          {needsParent ? 'Each detail belongs to one manufacturing location; the D2 form shows only the details of the chosen location.' : 'Shown in the D2 form.'}{' '}
          Deactivated values stay on complaints that already use them.
        </p>
      </div>
      <form onSubmit={add} className="flex flex-wrap items-start gap-2 border-b border-line px-5 py-3">
        {needsParent && (
          <select className="field-input w-auto" aria-label="Manufacturing location" value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">Choose location</option>
            {parents.filter((p) => p.active).map((p) => <option key={p._id}>{p.value}</option>)}
          </select>
        )}
        <input className="field-input min-w-[12rem] flex-1" placeholder="New value" aria-label={`New value for ${definition.label}`} value={value} onChange={(e) => setValue(e.target.value)} maxLength={120} />
        <Button type="submit" icon={Plus} disabled={!value.trim() || (needsParent && !parent)}>Add</Button>
        {error && <p className="w-full text-sm text-bad" role="alert">{error}</p>}
      </form>
      {groups.map(([groupName, items]) => (
        <div key={groupName || 'all'}>
          {groupName && <p className="bg-page/60 px-5 py-1.5 text-sm font-medium text-ink-muted">{groupName}</p>}
          {items.length === 0 ? (
            <p className="px-5 py-3 text-sm text-ink-muted">No values yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((r) => (
                <li key={r._id} className="flex flex-wrap items-center gap-2 px-5 py-2">
                  {editingId === r._id ? (
                    <form
                      className="flex flex-1 gap-2"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (await run(() => lookupApi.update(r._id, { value: editValue }), 'Renamed.')) setEditingId(null);
                      }}
                    >
                      <input className="field-input flex-1" value={editValue} onChange={(e) => setEditValue(e.target.value)} aria-label="Value" autoFocus />
                      <Button type="submit" size="sm" variant="primary">Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                    </form>
                  ) : (
                    <>
                      <span className={`flex-1 ${r.active ? '' : 'text-ink-faint line-through'}`}>{r.value}</span>
                      {!r.active && <Badge>Inactive</Badge>}
                      <Button size="sm" variant="ghost" onClick={() => { setEditingId(r._id); setEditValue(r.value); }}>Rename</Button>
                      <Button size="sm" variant="ghost" onClick={() => run(() => lookupApi.update(r._id, { active: !r.active }), r.active ? `“${r.value}” deactivated.` : `“${r.value}” reactivated.`)}>
                        {r.active ? 'Deactivate' : 'Reactivate'}
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}

export function SettingsPage() {
  const data = useAsync(() => lookupApi.all(true), []);
  return (
    <>
      <PageHeader title="Settings" description="Dropdown lists used in the complaint forms." />
      {data.loading && !data.data ? (
        <div className="panel"><Loading label="Loading lists" /></div>
      ) : data.error ? (
        <div className="panel"><ErrorState message={data.error} onRetry={data.reload} /></div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {Object.entries(data.data.definitions).map(([key, def]) => (
            <ListEditor key={key} listKey={key} definition={def} rows={data.data.lists[key]} parents={data.data.lists.manufacturingLocation} onChange={data.reload} />
          ))}
        </div>
      )}
    </>
  );
}
