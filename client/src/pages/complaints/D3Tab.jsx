import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, CornerDownRight, Lock } from 'lucide-react';
import { d3Api, complaintApi } from '../../api/endpoints.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { readError } from '../../api/client.js';
import { formatDate } from '../../lib/format.js';
import { Button } from '../../components/Button.jsx';
import { Badge } from '../../components/Badge.jsx';
import { Field } from '../../components/Field.jsx';
import { Modal } from '../../components/Modal.jsx';
import { Loading, ErrorState } from '../../components/States.jsx';
import { useToast } from '../../components/Toast.jsx';
import { FishboneDiagram } from './FishboneDiagram.jsx';
import { ReviewBanner, ReviewHistory } from './D3Review.jsx';

const ACTION_STATUS = {
  NOT_STARTED: ['Not started', 'neutral'],
  IN_PROGRESS: ['In progress', 'brand'],
  COMPLETED: ['Completed', 'ok'],
  VERIFIED: ['Verified', 'ok'],
  NOT_REQUIRED: ['Not required', 'neutral'],
};
const APPROVAL = { PENDING: ['Approval pending', 'warn'], APPROVED: ['Approved', 'ok'], REJECTED: ['Rejected', 'bad'] };

function ErrorList({ errors }) {
  if (!errors?.length) return null;
  return (
    <ul className="mb-3 space-y-0.5 rounded border border-bad/20 bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">
      {errors.map((m) => <li key={m}>{m}</li>)}
    </ul>
  );
}

/** Wrap a mutation: show its error, refresh with the returned D3 data. */
function useMutation(setData) {
  const notify = useToast();
  const [errors, setErrors] = useState(null);
  const run = async (fn, okMessage) => {
    setErrors(null);
    try {
      const res = await fn();
      setData(res.data);
      if (okMessage) notify(okMessage);
      return true;
    } catch (err) {
      const details = err.response?.data?.error?.details;
      setErrors(details?.length ? details.map((d) => d.message) : [readError(err).message]);
      return false;
    }
  };
  return { run, errors, clear: () => setErrors(null) };
}

/* ---------------- Method + problem statement ---------------- */

function AnalysisHeader({ complaintId, d3, setData, canEdit }) {
  const a = d3.analysis;
  const [problem, setProblem] = useState(a.problemStatement || '');
  const { run, errors } = useMutation(setData);
  useEffect(() => setProblem(a.problemStatement || ''), [a.problemStatement]);

  const toggle = (m) => {
    const methods = a.methods.includes(m) ? a.methods.filter((x) => x !== m) : [...a.methods, m];
    run(() => d3Api.updateAnalysis(complaintId, { version: a.__v, methods }));
  };

  return (
    <section>
      <ErrorList errors={errors} />
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">Analysis method</span>
        <div role="group" aria-label="Analysis method" className="inline-flex overflow-hidden rounded border border-line-strong">
          {[['WHY_WHY', 'Why-Why'], ['FISHBONE', 'Fishbone']].map(([m, label]) => (
            <button key={m} type="button" aria-pressed={a.methods.includes(m)} disabled={!canEdit} onClick={() => toggle(m)}
              className={`px-3 py-1.5 font-medium first:border-r first:border-line-strong disabled:cursor-default ${a.methods.includes(m) ? 'bg-brand text-white' : 'bg-surface text-ink-muted hover:bg-page'}`}>
              {label}
            </button>
          ))}
        </div>
        <span className="text-sm text-ink-muted">Choose one or both.</span>
      </div>
      <div className="mt-4">
        <Field label="Problem statement" hint="Shown at the head of the fishbone. State the effect, not the cause.">
          {(p) => (
            <div className="flex gap-2">
              <input {...p} className="field-input" value={problem} readOnly={!canEdit} maxLength={2000}
                placeholder="e.g. Broken induction seals on Rumicare Bolus batch RB2409" onChange={(e) => setProblem(e.target.value)} />
              {canEdit && problem !== (a.problemStatement || '') && (
                <Button variant="primary" onClick={() => run(() => d3Api.updateAnalysis(complaintId, { version: a.__v, problemStatement: problem }), 'Problem statement saved.')}>Save</Button>
              )}
            </div>
          )}
        </Field>
      </div>
    </section>
  );
}

/* ---------------- Why-Why ---------------- */

function WhyWhy({ complaintId, d3, setData, canEdit }) {
  const a = d3.analysis;
  const initial = a.whyWhy.length ? a.whyWhy.map((w) => ({ why: w.why || '', because: w.because || '' })) : [{ why: '', because: '' }];
  const [rows, setRows] = useState(initial);
  const { run, errors } = useMutation(setData);
  useEffect(() => setRows(initial), [a.__v]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);
  const set = (i, k, v) => setRows((r) => r.map((row, j) => (j === i ? { ...row, [k]: v } : row)));

  return (
    <section className="border-t border-line pt-5">
      <h3 className="font-semibold">Why-Why analysis</h3>
      <p className="mb-3 text-sm text-ink-muted">Ask why the problem happened, then why that happened, until you reach a cause you can act on.</p>
      <ErrorList errors={errors} />
      <ol className="space-y-3">
        {rows.map((row, i) => (
          <li key={i} className="grid gap-2 sm:grid-cols-[3rem_1fr_1fr_auto] sm:items-start">
            <span className="pt-1.5 text-sm font-semibold text-ink-muted">Why {i + 1}</span>
            <input className="field-input" aria-label={`Why ${i + 1}: question`} placeholder={i === 0 ? 'Why did the problem occur?' : 'Why did that happen?'}
              value={row.why} readOnly={!canEdit} onChange={(e) => set(i, 'why', e.target.value)} />
            <input className="field-input" aria-label={`Why ${i + 1}: answer`} placeholder="Because…" value={row.because} readOnly={!canEdit}
              onChange={(e) => set(i, 'because', e.target.value)} />
            {canEdit && rows.length > 1 ? (
              <button type="button" className="rounded p-1.5 text-ink-faint hover:bg-page hover:text-bad" aria-label={`Remove why ${i + 1}`}
                onClick={() => setRows((r) => r.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
            ) : <span />}
          </li>
        ))}
      </ol>
      {canEdit && (
        <div className="mt-3 flex flex-wrap justify-between gap-2">
          <Button size="sm" icon={Plus} disabled={rows.length >= 10} onClick={() => setRows((r) => [...r, { why: '', because: '' }])}>Add why</Button>
          <Button size="sm" variant="primary" disabled={!dirty}
            onClick={() => run(() => d3Api.updateAnalysis(complaintId, { version: a.__v, whyWhy: rows.filter((r) => r.why || r.because) }), 'Why-Why analysis saved.')}>
            Save Why-Why
          </Button>
        </div>
      )}
    </section>
  );
}

/* ---------------- Fishbone ---------------- */

function CauseEditor({ complaintId, d3, setData, canEdit }) {
  const [category, setCategory] = useState(d3.categories[0]);
  const [text, setText] = useState('');
  const [subFor, setSubFor] = useState(null);
  const [subText, setSubText] = useState('');
  const notify = useToast();
  const [editing, setEditing] = useState(null);
  const { run, errors } = useMutation(setData);

  const add = async (e) => {
    e.preventDefault();
    const existingCount = (d3.fishbone[category] || []).length;
    if (existingCount >= 3) {
      notify('Limit reached. You can add up to 3 descriptions for this category.', 'bad');
      return;
    }
    if (await run(() => d3Api.addCause(complaintId, { category, text }))) setText('');
  };

  const row = (c, sub) => (
    <li key={c._id} className={`flex items-center gap-2 py-1.5 ${sub ? 'pl-6' : ''}`}>
      {sub && <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />}
      {editing?._id === c._id ? (
        <form className="flex flex-1 gap-2" onSubmit={async (e) => { e.preventDefault(); if (await run(() => d3Api.updateCause(complaintId, c._id, { text: editing.text }))) setEditing(null); }}>
          <input className="field-input" value={editing.text} autoFocus aria-label="Cause" onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
          <Button size="sm" type="submit" variant="primary">Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
        </form>
      ) : (
        <>
          <span className={`flex-1 ${sub ? 'text-ink-muted' : ''}`}>{c.text}</span>
          {canEdit && (
            <span className="flex shrink-0 gap-0.5">
              {!sub && <Button size="sm" variant="ghost" onClick={() => { setSubFor(c._id); setSubText(''); }}>Add sub-cause</Button>}
              <button type="button" className="rounded p-1.5 text-ink-faint hover:bg-page hover:text-ink" aria-label={`Edit ${c.text}`} onClick={() => setEditing({ _id: c._id, text: c.text })}><Pencil className="h-3.5 w-3.5" /></button>
              <button type="button" className="rounded p-1.5 text-ink-faint hover:bg-page hover:text-bad" aria-label={`Remove ${c.text}`}
                onClick={() => run(() => d3Api.deleteCause(complaintId, c._id), sub ? 'Sub-cause removed.' : 'Cause removed.')}><Trash2 className="h-3.5 w-3.5" /></button>
            </span>
          )}
        </>
      )}
    </li>
  );

  return (
    <div className="mt-4">
      <ErrorList errors={errors} />
      {canEdit && (
        <form onSubmit={add} className="mb-3 flex flex-wrap gap-2">
          <select className="field-input w-auto" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {d3.categories.map((c) => <option key={c}>{c}</option>)}
          </select>
          <input className="field-input min-w-[14rem] flex-1" placeholder="Describe a possible cause" aria-label="New cause" maxLength={300} value={text} onChange={(e) => setText(e.target.value)} />
          <Button type="submit" icon={Plus} disabled={text.trim().length < 2}>Add cause</Button>
        </form>
      )}
      <div className="divide-y divide-line rounded border border-line">
        {d3.categories.map((cat) => (
          <div key={cat} className="px-3 py-2">
            <p className="text-sm font-semibold">{cat} <span className="font-normal text-ink-faint">{d3.fishbone[cat].length || ''}</span></p>
            {d3.fishbone[cat].length === 0 ? (
              <p className="py-1 text-sm text-ink-faint">No causes</p>
            ) : (
              <ul>
                {d3.fishbone[cat].map((c) => (
                  <div key={c._id}>
                    {row(c, false)}
                    <ul>{c.children.map((s) => row(s, true))}</ul>
                    {subFor === c._id && (
                      <form className="flex gap-2 py-1.5 pl-6" onSubmit={async (e) => { e.preventDefault(); if (await run(() => d3Api.addCause(complaintId, { text: subText, parent: c._id }))) setSubFor(null); }}>
                        <input className="field-input" autoFocus placeholder={`Sub-cause of “${c.text}”`} aria-label="New sub-cause" value={subText} onChange={(e) => setSubText(e.target.value)} />
                        <Button size="sm" type="submit" variant="primary" disabled={subText.trim().length < 2}>Add</Button>
                        <Button size="sm" variant="ghost" onClick={() => setSubFor(null)}>Cancel</Button>
                      </form>
                    )}
                  </div>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Root causes and CAPA ---------------- */

function RootCauseModal({ open, d3, initial, onClose, onSave }) {
  const [form, setForm] = useState({ category: d3.categories[0], description: '' });
  const [errors, setErrors] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setForm(initial || { category: d3.categories[0], description: '' }); setErrors(null); } }, [open]); // eslint-disable-line
  const save = async () => { setBusy(true); const e = await onSave(form); setBusy(false); if (e) setErrors(e); };
  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Edit root cause' : 'Add root cause'}
      description="A confirmed cause of the problem. Add a CAPA record to it afterwards."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save root cause</Button></>}>
      <ErrorList errors={errors} />
      <div className="space-y-4">
        <Field label="Root cause category" required>
          {(p) => <select {...p} className="field-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{d3.categories.map((c) => <option key={c}>{c}</option>)}</select>}
        </Field>
        <Field label="Root cause description" required>
          {(p) => <textarea {...p} rows={3} maxLength={2000} className="field-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />}
        </Field>
      </div>
    </Modal>
  );
}

const EMPTY_CAPA = { capaRequired: true, category: '', description: '', correctiveAction: '', preventiveAction: '', responsiblePerson: '', targetDate: '', actionStatus: 'NOT_STARTED' };

function CapaModal({ open, initial, people, onClose, onSave }) {
  const [form, setForm] = useState(EMPTY_CAPA);
  const [errors, setErrors] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErrors(null);
    setForm(initial ? {
      ...EMPTY_CAPA, ...Object.fromEntries(Object.keys(EMPTY_CAPA).map((k) => [k, initial[k] ?? EMPTY_CAPA[k]])),
      responsiblePerson: initial.responsiblePerson?._id || '', targetDate: initial.targetDate ? new Date(initial.targetDate).toLocaleDateString('en-CA') : '',
    } : EMPTY_CAPA);
  }, [open]); // eslint-disable-line
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = async () => { setBusy(true); const e = await onSave(form); setBusy(false); if (e) setErrors(e); };
  const req = form.capaRequired;

  return (
    <Modal open={open} onClose={onClose} width="max-w-2xl" title={initial ? `Edit ${initial.capaNumber}` : 'Add CAPA'}
      description="Corrective and preventive action for this root cause. Recording it does not mark it complete."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save CAPA</Button></>}>
      <ErrorList errors={errors} />
      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-sm font-medium">Is CAPA required?<span className="ml-0.5 text-bad" aria-hidden>*</span></legend>
          <div className="flex gap-4">
            {[[true, 'Yes'], [false, 'No']].map(([v, l]) => (
              <label key={l} className="flex items-center gap-1.5"><input type="radio" className="accent-brand" checked={form.capaRequired === v} onChange={() => setForm({ ...form, capaRequired: v })} />{l}</label>
            ))}
          </div>
        </fieldset>
        <Field label="CAPA category">{(p) => <input {...p} className="field-input" value={form.category} onChange={set('category')} />}</Field>
        {req && (
          <Field label="Action status">
            {(p) => <select {...p} className="field-input" value={form.actionStatus === 'NOT_REQUIRED' ? 'NOT_STARTED' : form.actionStatus} onChange={set('actionStatus')}>
              {['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED'].map((s) => <option key={s} value={s}>{ACTION_STATUS[s][0]}</option>)}
            </select>}
          </Field>
        )}
        <Field label={req ? 'CAPA description' : 'Why is CAPA not required?'} required={!req} className="sm:col-span-2">
          {(p) => <textarea {...p} rows={2} className="field-input" value={form.description} onChange={set('description')} />}
        </Field>
        {req && (
          <>
            <Field label="Corrective action" required className="sm:col-span-2">{(p) => <textarea {...p} rows={2} className="field-input" value={form.correctiveAction} onChange={set('correctiveAction')} />}</Field>
            <Field label="Preventive action" className="sm:col-span-2">{(p) => <textarea {...p} rows={2} className="field-input" value={form.preventiveAction} onChange={set('preventiveAction')} />}</Field>
            <Field label="Responsible person" required>
              {(p) => <select {...p} className="field-input" value={form.responsiblePerson} onChange={set('responsiblePerson')}>
                <option value="">Select</option>
                {people.map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
              </select>}
            </Field>
            <Field label="Target completion date" required>{(p) => <input {...p} type="date" className="field-input" value={form.targetDate} onChange={set('targetDate')} />}</Field>
          </>
        )}
      </div>
    </Modal>
  );
}

function RootCauses({ complaintId, d3, setData, canEdit }) {
  const notify = useToast();
  const [rcModal, setRcModal] = useState(null); // {initial?}
  const [capaModal, setCapaModal] = useState(null); // {rc, initial?}
  const [people, setPeople] = useState([]);
  useEffect(() => { if (canEdit) d3Api.people().then((r) => setPeople(r.data)).catch(() => {}); }, [canEdit]);

  const save = async (fn, ok) => {
    try {
      const res = await fn();
      setData(res.data);
      notify(ok);
      setRcModal(null);
      setCapaModal(null);
      return null;
    } catch (err) {
      const details = err.response?.data?.error?.details;
      return details?.length ? details.map((d) => d.message) : [readError(err).message];
    }
  };
  const capaBody = (f) => ({ ...f, responsiblePerson: f.responsiblePerson || undefined, targetDate: f.targetDate || undefined });

  return (
    <section className="border-t border-line pt-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">Root causes and CAPA</h3>
          <p className="text-sm text-ink-muted">Record each confirmed root cause, then the corrective and preventive action for it.</p>
        </div>
        {canEdit && <Button icon={Plus} onClick={() => setRcModal({})}>Add root cause</Button>}
      </div>
      {d3.rootCauses.length === 0 ? (
        <p className="rounded border border-dashed border-line-strong px-4 py-6 text-center text-ink-muted">No root causes recorded yet.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-line">
          <table className="w-full min-w-[44rem] text-left">
            <thead className="border-b border-line bg-page/60 text-sm text-ink-muted">
              <tr>
                <th className="py-2 pl-3 pr-2 font-medium">Root cause</th>
                <th className="px-2 py-2 font-medium">CAPA and actions</th>
                <th className="px-2 py-2 font-medium">Owner and due date</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {d3.rootCauses.map((rc) => {
                const capas = rc.capas.length ? rc.capas : [null];
                return capas.map((capa, i) => (
                  <tr key={`${rc._id}-${capa?._id || 'none'}`} className={`align-top ${i === capas.length - 1 ? 'border-b border-line last:border-0' : ''}`}>
                    {i === 0 && (
                      <td rowSpan={capas.length} className="w-[30%] min-w-[13rem] py-2.5 pl-3 pr-2">
                        <Badge>{rc.category}</Badge>
                        <p className="mt-1">{rc.description}</p>
                        {canEdit && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setCapaModal({ rc })}>Add CAPA</Button>
                            <Button size="sm" variant="ghost" onClick={() => setRcModal({ initial: rc })}>Edit</Button>
                            <Button size="sm" variant="ghost" onClick={async () => { const e = await save(() => d3Api.deleteRootCause(complaintId, rc._id), 'Root cause removed.'); if (e) notify(e[0], 'bad'); }}>Remove</Button>
                          </div>
                        )}
                      </td>
                    )}
                    {capa ? (
                      <>
                        <td className="px-2 py-2.5">
                          <p className="font-medium"><span className="whitespace-nowrap">{capa.capaNumber}</span>{capa.category && <span className="font-normal text-ink-muted"> · {capa.category}</span>}</p>
                          {capa.capaRequired ? (
                            <>
                              <p><span className="text-ink-muted">Corrective: </span>{capa.correctiveAction}</p>
                              {capa.preventiveAction && <p className="mt-0.5"><span className="text-ink-muted">Preventive: </span>{capa.preventiveAction}</p>}
                            </>
                          ) : (
                            <p className="text-ink-muted">Not required: {capa.description}</p>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2.5">
                          {capa.responsiblePerson?.name || <span className="text-ink-faint">—</span>}
                          {capa.targetDate && <span className="block text-sm text-ink-muted">Due {formatDate(capa.targetDate)}</span>}
                        </td>
                        <td className="space-y-1 px-2 py-2.5">
                          <div><Badge tone={ACTION_STATUS[capa.actionStatus][1]}>{ACTION_STATUS[capa.actionStatus][0]}</Badge></div>
                          <div><Badge tone={APPROVAL[capa.approvalStatus][1]}>{APPROVAL[capa.approvalStatus][0]}</Badge></div>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-right">
                          {canEdit && (
                            <>
                              <button type="button" className="rounded p-1.5 text-ink-faint hover:bg-page hover:text-ink" aria-label={`Edit ${capa.capaNumber}`} onClick={() => setCapaModal({ rc, initial: capa })}><Pencil className="h-3.5 w-3.5" /></button>
                              <button type="button" className="rounded p-1.5 text-ink-faint hover:bg-page hover:text-bad" aria-label={`Remove ${capa.capaNumber}`}
                                onClick={async () => { const e = await save(() => d3Api.deleteCapa(complaintId, capa._id), `${capa.capaNumber} removed.`); if (e) notify(e[0], 'bad'); }}><Trash2 className="h-3.5 w-3.5" /></button>
                            </>
                          )}
                        </td>
                      </>
                    ) : (
                      <td colSpan={4} className="px-2 py-2.5 text-ink-faint">No CAPA recorded for this root cause yet.</td>
                    )}
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      )}
      <RootCauseModal open={Boolean(rcModal)} d3={d3} initial={rcModal?.initial && { category: rcModal.initial.category, description: rcModal.initial.description }}
        onClose={() => setRcModal(null)}
        onSave={(f) => save(() => (rcModal.initial ? d3Api.updateRootCause(complaintId, rcModal.initial._id, f) : d3Api.addRootCause(complaintId, f)), 'Root cause saved.')} />
      <CapaModal open={Boolean(capaModal)} initial={capaModal?.initial} people={people} onClose={() => setCapaModal(null)}
        onSave={(f) => save(() => (capaModal.initial ? d3Api.updateCapa(complaintId, capaModal.initial._id, { ...capaBody(f), version: capaModal.initial.__v }) : d3Api.addCapa(complaintId, capaModal.rc._id, capaBody(f))), 'CAPA saved.')} />
    </section>
  );
}

/* ---------------- CAPA Implementation & Multi-Tier Approval (PDF Pages 14-19) ---------------- */

function CapaImplementationSection({ complaint, d3, onReload }) {
  const { user } = useAuth();
  const notify = useToast();
  const [editingId, setEditingId] = useState(null);
  const [actionText, setActionText] = useState('');
  const [forwardCheck, setForwardCheck] = useState(false);
  const [busy, setBusy] = useState(false);

  const [decisionModal, setDecisionModal] = useState(null); // { capa, tier }
  const [decisionType, setDecisionType] = useState('APPROVED');
  const [decisionComments, setDecisionComments] = useState('');

  const capas = (d3.rootCauses || []).flatMap((r) => r.capas || []);
  if (capas.length === 0) return null;

  const handleSaveImplementation = async (capaId) => {
    try {
      setBusy(true);
      await complaintApi.updateCapaImplementation(complaint._id, capaId, {
        actionImplemented: actionText,
        forwardForReview: forwardCheck,
      });
      notify('CAPA implementation details updated.');
      setEditingId(null);
      onReload();
    } catch (err) {
      notify(readError(err).message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  const handleDecision = async () => {
    try {
      setBusy(true);
      await complaintApi.decideImplementationApproval(complaint._id, decisionModal.capa._id, {
        tier: decisionModal.tier,
        decision: decisionType,
        comments: decisionComments,
      });
      notify(`CAPA implementation ${decisionType.toLowerCase()} at ${decisionModal.tier} tier.`);
      setDecisionModal(null);
      onReload();
    } catch (err) {
      notify(readError(err).message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-t border-slate-200 pt-5">
      <div className="mb-3">
        <h3 className="font-semibold text-slate-800 text-sm uppercase tracking-wider">
          v CAPA Implementation
        </h3>
        <p className="text-xs text-slate-500">
          Following approval of the root cause, Responsible Persons execute actions and submit for review.
        </p>
      </div>

      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="w-full text-left text-xs divide-y divide-slate-200">
          <thead className="bg-slate-50 font-semibold text-slate-700">
            <tr>
              <th className="px-3 py-2.5">CA / PA</th>
              <th className="px-3 py-2.5">Description</th>
              <th className="px-3 py-2.5">Responsible Person</th>
              <th className="px-3 py-2.5">Timeline</th>
              <th className="px-3 py-2.5">Action Implemented</th>
              <th className="px-3 py-2.5 text-center">Forward for Review</th>
              <th className="px-3 py-2.5 text-right">Approval Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {capas.map((capa) => {
              const isEditing = editingId === capa._id;
              const isRp = String(capa.responsiblePerson?._id || capa.responsiblePerson) === String(user._id);
              const isFrp = String(complaint.frp?._id || complaint.frp) === String(user._id);
              const isHandler = user.roles?.includes('quality_coordinator') || user.roles?.includes('admin');
              const isQa = user.roles?.includes('reviewer') || user.roles?.includes('admin');

              return (
                <tr key={capa._id} className="hover:bg-slate-50/50">
                  <td className="px-3 py-2.5 font-bold text-slate-900">
                    {capa.capaNumber} ({capa.category || 'CA'})
                  </td>
                  <td className="px-3 py-2.5 text-slate-700 max-w-xs">
                    {capa.description}
                  </td>
                  <td className="px-3 py-2.5 text-slate-700">
                    {capa.responsiblePerson?.name || 'Unassigned'}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">
                    {capa.targetDate ? formatDate(capa.targetDate) : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    {isEditing ? (
                      <div className="space-y-1.5">
                        <textarea
                          rows={2}
                          className="w-full text-xs rounded border border-slate-300 p-1.5"
                          value={actionText}
                          onChange={(e) => setActionText(e.target.value)}
                        />
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                          <Button size="sm" onClick={() => handleSaveImplementation(capa._id)} disabled={busy}>Save</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <span className={capa.actionImplemented ? 'text-slate-800' : 'text-slate-400 italic'}>
                          {capa.actionImplemented || 'Not entered yet'}
                        </span>
                        {(isRp || isFrp || isHandler) && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(capa._id);
                              setActionText(capa.actionImplemented || '');
                              setForwardCheck(capa.forwardForReview || false);
                            }}
                            className="text-blue-600 hover:text-blue-800 font-medium"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {isEditing ? (
                      <input
                        type="checkbox"
                        checked={forwardCheck}
                        onChange={(e) => setForwardCheck(e.target.checked)}
                        className="h-4 w-4 rounded text-blue-600"
                      />
                    ) : (
                      <span className={capa.forwardForReview ? 'text-emerald-600 font-bold' : 'text-slate-400'}>
                        {capa.forwardForReview ? '✓ Yes' : 'No'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right space-x-1 whitespace-nowrap">
                    {capa.forwardForReview && (
                      <>
                        {/* FRP Tier */}
                        {capa.frpImplementationApproval?.status === 'PENDING' && isFrp && (
                          <Button size="sm" variant="secondary" onClick={() => { setDecisionModal({ capa, tier: 'FRP' }); setDecisionType('APPROVED'); setDecisionComments(''); }}>
                            FRP Review
                          </Button>
                        )}
                        {/* Handler Tier */}
                        {capa.handlerImplementationApproval?.status === 'PENDING' && isHandler && (
                          <Button size="sm" variant="secondary" onClick={() => { setDecisionModal({ capa, tier: 'HANDLER' }); setDecisionType('APPROVED'); setDecisionComments(''); }}>
                            Handler Review
                          </Button>
                        )}
                        {/* QA Tier */}
                        {capa.qaImplementationApproval?.status === 'PENDING' && isQa && (
                          <Button size="sm" variant="secondary" onClick={() => { setDecisionModal({ capa, tier: 'QA' }); setDecisionType('APPROVED'); setDecisionComments(''); }}>
                            QA Approval
                          </Button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Approval History (3) Card (PDF Page 16 & 17) */}
      {capas.some((c) => c.approvalHistory?.length > 0) && (
        <div className="mt-4 rounded border border-slate-200 bg-white p-4 shadow-sm">
          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
            Approval History
          </h4>
          <div className="space-y-3">
            {capas.map((capa) => (
              capa.approvalHistory?.length > 0 && (
                <div key={capa._id} className="border border-slate-100 rounded p-3 bg-slate-50/50">
                  <p className="font-semibold text-xs text-slate-900 mb-1.5">{capa.capaNumber} History</p>
                  <div className="space-y-2">
                    {capa.approvalHistory.map((h, idx) => (
                      <div key={idx} className="text-xs bg-white p-2.5 rounded border border-slate-200">
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-semibold text-blue-700">{h.step}</span>
                          <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${h.status === 'Approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                            {h.status}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-4">
                          <span>Date: {formatDate(h.date)}</span>
                          <span>Approver: {h.actualApprover || h.assignedTo}</span>
                        </div>
                        {h.comments && <p className="text-slate-700 text-xs mt-1">Comments: {h.comments}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )
            ))}
          </div>
        </div>
      )}

      {/* Decision Modal */}
      {decisionModal && (
        <Modal open title={`${decisionModal.tier} Review for ${decisionModal.capa.capaNumber}`} onClose={() => setDecisionModal(null)}>
          <div className="space-y-3 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Decision</label>
              <select
                value={decisionType}
                onChange={(e) => setDecisionType(e.target.value)}
                className="w-full rounded border border-slate-300 p-2 focus:outline-none"
              >
                <option value="APPROVED">Approve</option>
                <option value="REJECTED">Reject (Action Required)</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Comments</label>
              <textarea
                rows={3}
                placeholder="Enter review remarks..."
                value={decisionComments}
                onChange={(e) => setDecisionComments(e.target.value)}
                className="w-full rounded border border-slate-300 p-2 focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button variant="secondary" onClick={() => setDecisionModal(null)}>Cancel</Button>
              <Button onClick={handleDecision} disabled={busy}>Submit Decision</Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

/* ---------------- Tab ---------------- */

export function D3Tab({ complaint, review, refreshKey, onChanged }) {
  const [latestRejection, setLatestRejection] = useState(null);
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const load = () => d3Api.get(complaint._id).then((r) => setState({ loading: false, error: null, data: r.data })).catch((e) => setState({ loading: false, error: readError(e).message, data: null }));
  useEffect(() => { load(); }, [complaint._id, complaint.status]); // eslint-disable-line
  const setData = (data) => { setState({ loading: false, error: null, data }); onChanged?.(); };

  if (state.loading) return <Loading label="Loading analysis" />;
  if (state.error) return <ErrorState message={state.error} onRetry={load} />;
  const d3 = state.data;
  if (!d3.analysis) {
    return <p className="text-ink-muted">{complaint.status === 'D2_COMPLETED' ? 'D2 is complete. The First Responsible Person starts the analysis from the next-step panel.' : 'The root cause analysis opens after D2 is completed.'}</p>;
  }
  const { canEdit } = d3;
  const methods = d3.analysis.methods;

  return (
    <div className="space-y-6">
      <ReviewBanner complaint={complaint} review={review} latestRejection={latestRejection} />
      {!canEdit && (
        <p className="flex items-center gap-1.5 text-sm text-ink-muted"><Lock className="h-3.5 w-3.5" aria-hidden />
          {['D3_IN_PROGRESS', 'D3_REWORK'].includes(complaint.status)
            ? 'Only the First Responsible Person can change the analysis. You can view it.'
            : complaint.status === 'D3_PENDING_APPROVAL'
              ? 'The analysis is locked while it is reviewed.'
              : 'The analysis cannot be changed at this stage.'}
        </p>
      )}
      <AnalysisHeader complaintId={complaint._id} d3={d3} setData={setData} canEdit={canEdit} />
      {methods.length === 0 && <p className="rounded border border-dashed border-line-strong px-4 py-4 text-ink-muted">Choose Why-Why, Fishbone or both to start the analysis.</p>}
      {methods.includes('WHY_WHY') && <WhyWhy complaintId={complaint._id} d3={d3} setData={setData} canEdit={canEdit} />}
      {methods.includes('FISHBONE') && (
        <section className="border-t border-line pt-5">
          <h3 className="font-semibold">Fishbone diagram</h3>
          <p className="mb-3 text-sm text-ink-muted">Generated from the causes below and updated as you change them.</p>
          <FishboneDiagram categories={d3.categories} tree={d3.fishbone} problem={d3.analysis.problemStatement} complaintNumber={complaint.complaintNumber} />
          <CauseEditor complaintId={complaint._id} d3={d3} setData={setData} canEdit={canEdit} />
        </section>
      )}
      <RootCauses complaintId={complaint._id} d3={d3} setData={setData} canEdit={canEdit} />
      <CapaImplementationSection complaint={complaint} d3={d3} onReload={load} />
      <ReviewHistory complaintId={complaint._id} complaintNumber={complaint.complaintNumber} refreshKey={`${refreshKey}-${complaint.status}`}
        onLoaded={(list) => setLatestRejection(list.find((r) => r.kind === 'REJECTION') || null)} />
    </div>
  );
}
