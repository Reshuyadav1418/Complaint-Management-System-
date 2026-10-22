import { useEffect, useState } from 'react';
import { Pencil, UserPlus, Lock } from 'lucide-react';
import { complaintApi, lookupApi } from '../../api/endpoints.js';
import { readError } from '../../api/client.js';
import { useAsync } from '../../lib/useAsync.js';
import { formatDateTime } from '../../lib/format.js';
import { Button } from '../../components/Button.jsx';
import { Badge } from '../../components/Badge.jsx';
import { Field } from '../../components/Field.jsx';
import { Modal } from '../../components/Modal.jsx';
import { Loading } from '../../components/States.jsx';
import { useToast } from '../../components/Toast.jsx';

const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const PRIORITY_TONE = { Low: 'neutral', Medium: 'brand', High: 'warn', Critical: 'bad' };

/* ---------------- form <-> API ---------------- */

const str = (v) => (v === null || v === undefined ? '' : String(v));
const yn = (v) => (v === true ? 'yes' : v === false ? 'no' : '');

function toForm(c) {
  const vp = c.d2?.verifiedProduct || {};
  const inv = c.d2?.investigation || {};
  const sc = (o) => ({ value: str(o?.value), score: str(o?.score) });
  return {
    priority: c.priority || '',
    verifiedProduct: {
      performanceRelated: yn(vp.performanceRelated),
      // Start from the reported values so the verifier only corrects what differs.
      productName: str(vp.productName ?? c.reportedProduct?.name),
      batchNumber: str(vp.batchNumber ?? c.reportedProduct?.batchNumber),
      sku: str(vp.sku),
      invoiceQuantity: str(vp.invoiceQuantity),
      remarks: str(vp.remarks),
    },
    investigation: {
      occurrences: sc(inv.occurrences),
      affectedQuantity: sc(inv.affectedQuantity),
      severity: sc(inv.severity),
      rpn: str(inv.rpn),
      manufacturingLocation: str(inv.manufacturingLocation),
      locationDetail: str(inv.locationDetail),
      repeatComplaint: yn(inv.repeatComplaint),
      typeOfFailure: str(inv.typeOfFailure),
      slaHoursD3: str(inv.slaHoursD3),
      slaHoursD4: str(inv.slaHoursD4),
    },
  };
}

function toBody(f) {
  const bool = (v) => (v === 'yes' ? true : v === 'no' ? false : null);
  return {
    priority: f.priority,
    verifiedProduct: { ...f.verifiedProduct, performanceRelated: bool(f.verifiedProduct.performanceRelated) },
    investigation: { ...f.investigation, repeatComplaint: bool(f.investigation.repeatComplaint) },
  };
}

/* ---------------- read-only view ---------------- */

function Item({ label, children, wide }) {
  const empty = children === undefined || children === null || children === '';
  return (
    <div className={wide ? 'sm:col-span-2 lg:col-span-3' : ''}>
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="mt-0.5 break-words">{empty ? <span className="text-ink-faint">Not recorded</span> : children}</dd>
    </div>
  );
}
const yesNo = (v) => (v === true ? 'Yes' : v === false ? 'No' : null);

function D2View({ c }) {
  const vp = c.d2?.verifiedProduct || {};
  const inv = c.d2?.investigation || {};
  const factors = [
    ['A', 'Occurrences of the event', inv.occurrences],
    ['B', 'Affected quantity', inv.affectedQuantity],
    ['C', 'Severity', inv.severity],
  ];
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 font-semibold">Verified product information</h3>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <Item label="Product">{vp.productName}</Item>
          <Item label="Batch number">{vp.batchNumber}</Item>
          <Item label="SKU">{vp.sku}</Item>
          <Item label="Invoice quantity">{vp.invoiceQuantity}</Item>
          <Item label="Performance / efficacy related">{yesNo(vp.performanceRelated)}</Item>
          <Item label="Priority">{c.priority && <Badge tone={PRIORITY_TONE[c.priority]}>{c.priority}</Badge>}</Item>
          <Item label="Remarks" wide>{vp.remarks}</Item>
        </dl>
      </section>
      <section className="border-t border-line pt-5">
        <h3 className="mb-3 font-semibold">Preliminary investigation</h3>
        <div className="mb-4 overflow-x-auto">
          <table className="w-full max-w-xl text-left">
            <thead className="text-sm text-ink-muted">
              <tr className="border-b border-line">
                <th className="py-1.5 pr-3 font-medium">Factor</th>
                <th className="px-3 py-1.5 font-medium">Observation</th>
                <th className="py-1.5 pl-3 text-right font-medium">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {factors.map(([k, label, f]) => (
                <tr key={k}>
                  <td className="py-2 pr-3"><span className="mr-2 font-semibold text-ink-muted">{k}</span>{label}</td>
                  <td className="px-3 py-2">{f?.value || <span className="text-ink-faint">—</span>}</td>
                  <td className="py-2 pl-3 text-right font-medium">{f?.score ?? <span className="text-ink-faint">—</span>}</td>
                </tr>
              ))}
              <tr>
                <td className="py-2 pr-3 font-semibold" colSpan={2}>RPN value</td>
                <td className="py-2 pl-3 text-right font-semibold">{inv.rpn ?? <span className="font-normal text-ink-faint">—</span>}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <Item label="Manufacturing location">{inv.manufacturingLocation}</Item>
          <Item label="Location detail">{inv.locationDetail}</Item>
          <Item label="Type of failure">{inv.typeOfFailure}</Item>
          <Item label="Repeat complaint">{yesNo(inv.repeatComplaint)}</Item>
          <Item label="SLA hours for D3">{inv.slaHoursD3}</Item>
          <Item label="SLA hours for D4">{inv.slaHoursD4}</Item>
        </dl>
      </section>
      {c.d2?.completedAt && (
        <p className="border-t border-line pt-4 text-ink-muted">
          D2 completed by {c.d2.completedBy?.name} on {formatDateTime(c.d2.completedAt)}.
        </p>
      )}
    </div>
  );
}

/* ---------------- edit form ---------------- */

function D2Form({ form, setForm, errors, lists }) {
  const set = (path) => (e) => {
    const value = e.target.value;
    setForm((f) => {
      const next = structuredClone(f);
      const keys = path.split('.');
      let o = next;
      keys.slice(0, -1).forEach((k) => (o = o[k]));
      o[keys.at(-1)] = value;
      // Changing the location clears a detail that belongs to another location.
      if (path === 'investigation.manufacturingLocation') next.investigation.locationDetail = '';
      return next;
    });
  };
  const val = (path) => path.split('.').reduce((o, k) => o[k], form);
  const input = (path, props = {}) => (p) => <input {...p} className="field-input" value={val(path)} onChange={set(path)} {...props} />;
  const select = (path, options, placeholder = 'Select') => (p) => (
    <select {...p} className="field-input" value={val(path)} onChange={set(path)}>
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
      {/* Keep a saved value visible even if it was later removed from the list. */}
      {val(path) && !options.includes(val(path)) && <option value={val(path)}>{val(path)} (no longer in list)</option>}
    </select>
  );
  const yesNoSelect = (path) => (p) => (
    <select {...p} className="field-input" value={val(path)} onChange={set(path)}>
      <option value="">Not recorded</option>
      <option value="yes">Yes</option>
      <option value="no">No</option>
    </select>
  );
  const details = lists.locationDetail.filter((d) => d.parent?.toLowerCase() === form.investigation.manufacturingLocation.toLowerCase()).map((d) => d.value);
  const num = { type: 'number', min: 0, inputMode: 'decimal' };

  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="mb-3 font-semibold">Verified product information</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Product" error={errors['verifiedProduct.productName']}>{input('verifiedProduct.productName')}</Field>
          <Field label="Batch number" required error={errors['verifiedProduct.batchNumber']}>{input('verifiedProduct.batchNumber')}</Field>
          <Field label="SKU" error={errors['verifiedProduct.sku']}>{input('verifiedProduct.sku')}</Field>
          <Field label="Invoice quantity" error={errors['verifiedProduct.invoiceQuantity']}>{input('verifiedProduct.invoiceQuantity', num)}</Field>
          <Field label="Performance / efficacy related" error={errors['verifiedProduct.performanceRelated']}>{yesNoSelect('verifiedProduct.performanceRelated')}</Field>
          <Field label="Priority" error={errors.priority} hint="High and Critical add an urgency line to the FRP email.">{select('priority', PRIORITIES, 'Not set')}</Field>
          <Field label="Remarks" error={errors['verifiedProduct.remarks']} className="sm:col-span-2 lg:col-span-3">
            {(p) => <textarea {...p} rows={2} className="field-input" value={val('verifiedProduct.remarks')} onChange={set('verifiedProduct.remarks')} />}
          </Field>
        </div>
      </fieldset>

      <fieldset className="border-t border-line pt-5">
        <legend className="mb-3 bg-surface pr-2 font-semibold">Preliminary investigation</legend>
        <div className="space-y-3">
          {[
            ['occurrences', 'A', 'Number of occurrences of the event'],
            ['affectedQuantity', 'B', 'Affected quantity'],
            ['severity', 'C', 'Severity'],
          ].map(([key, letter, label]) => (
            <div key={key} className="grid gap-3 sm:grid-cols-[1fr_8rem]">
              <Field label={`${letter}. ${label}`} error={errors[`investigation.${key}.value`]}>{input(`investigation.${key}.value`)}</Field>
              <Field label="Score" required={key === 'severity'} error={errors[`investigation.${key}.score`]}>{input(`investigation.${key}.score`, num)}</Field>
            </div>
          ))}
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <p className="self-end pb-2 text-sm text-ink-muted">
              RPN is entered as calculated under the company’s scoring rule. Automatic calculation will be added once the rule is confirmed.
            </p>
            <Field label="RPN value" error={errors['investigation.rpn']}>{input('investigation.rpn', num)}</Field>
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Manufacturing location" required error={errors['investigation.manufacturingLocation']}>
            {select('investigation.manufacturingLocation', lists.manufacturingLocation.map((v) => v.value))}
          </Field>
          <Field label="Location detail" error={errors['investigation.locationDetail']} hint={!form.investigation.manufacturingLocation ? 'Choose the location first.' : null}>
            {(p) => (form.investigation.manufacturingLocation ? select('investigation.locationDetail', details)(p) : <select {...p} className="field-input" disabled><option>Select</option></select>)}
          </Field>
          <Field label="Type of failure" required error={errors['investigation.typeOfFailure']}>
            {select('investigation.typeOfFailure', lists.typeOfFailure.map((v) => v.value))}
          </Field>
          <Field label="Repeat complaint" error={errors['investigation.repeatComplaint']}>{yesNoSelect('investigation.repeatComplaint')}</Field>
          <Field label="SLA hours for D3" error={errors['investigation.slaHoursD3']}>{input('investigation.slaHoursD3', num)}</Field>
          <Field label="SLA hours for D4" error={errors['investigation.slaHoursD4']}>{input('investigation.slaHoursD4', num)}</Field>
        </div>
      </fieldset>
    </div>
  );
}

/* ---------------- FRP assignment ---------------- */

function AssignFrpModal({ open, complaint, onClose, onDone }) {
  const candidates = useAsync(() => (open ? complaintApi.frpCandidates() : Promise.resolve({ data: [] })), [open]);
  const [selected, setSelected] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const reassigning = Boolean(complaint.frp);

  useEffect(() => {
    if (open) {
      setSelected('');
      setReason('');
      setErrors({});
    }
  }, [open]);

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const res = await complaintApi.assignFrp(complaint._id, { assigneeId: selected, reason: reason || undefined });
      const person = candidates.data.find((u) => u._id === selected);
      onDone(res.data, person);
    } catch (err) {
      const e = readError(err);
      setErrors(Object.keys(e.fields).length ? e.fields : { _: e.message });
    } finally {
      setBusy(false);
    }
  };

  const options = (candidates.data || []).filter((u) => u._id !== complaint.frp?._id);

  return (
    <Modal open={open} onClose={onClose} width="max-w-xl"
      title={reassigning ? 'Reassign First Responsible Person' : 'Assign First Responsible Person'}
      description={`${complaint.complaintNumber}. The selected person can then see this complaint and is emailed the details.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!selected} onClick={save}>{reassigning ? 'Reassign and notify' : 'Assign and notify'}</Button></>}>
      {errors._ && <p className="mb-4 rounded border border-bad/20 bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">{errors._}</p>}
      {candidates.loading && !candidates.data?.length ? (
        <Loading label="Loading investigators" />
      ) : options.length === 0 ? (
        <p className="text-ink-muted">No other active employee has a role that can investigate complaints. An administrator can give someone the First Responsible Person role.</p>
      ) : (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Employee<span className="ml-0.5 text-bad" aria-hidden>*</span></legend>
          <div className="max-h-64 divide-y divide-line overflow-y-auto rounded border border-line">
            {options.map((u) => (
              <label key={u._id} className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${selected === u._id ? 'bg-brand-soft' : 'hover:bg-page'}`}>
                <input type="radio" name="frp" className="accent-brand" checked={selected === u._id} onChange={() => setSelected(u._id)} />
                <span className="flex-1">
                  <span className="font-medium">{u.name}</span>
                  <span className="block text-sm text-ink-muted">{[u.designation, u.department?.name].filter(Boolean).join(', ') || u.email}</span>
                </span>
                <span className="text-sm text-ink-muted">{u.openComplaints} open</span>
              </label>
            ))}
          </div>
          {errors.assigneeId && <p className="mt-1 text-sm text-bad">{errors.assigneeId}</p>}
        </fieldset>
      )}
      {reassigning && (
        <Field label="Reason for reassignment" required error={errors.reason} className="mt-4"
          hint={`Recorded in the history. ${complaint.frp.name} loses access unless they can see all complaints.`}>
          {(p) => <textarea {...p} rows={2} maxLength={1000} className="field-input" value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      )}
    </Modal>
  );
}

function FrpSection({ detail, onChanged, refreshKey }) {
  const { complaint: c, can } = detail;
  const notify = useToast();
  const history = useAsync(() => complaintApi.assignments(c._id), [c._id, refreshKey]);
  const [open, setOpen] = useState(false);

  return (
    <section className="border-t border-line pt-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">First Responsible Person</h3>
        {can.assignFrp && (
          <Button size="sm" icon={UserPlus} onClick={() => setOpen(true)}>{c.frp ? 'Reassign' : 'Assign FRP'}</Button>
        )}
      </div>
      {c.frp ? (
        <p>
          <span className="font-medium">{c.frp.name}</span>
          <span className="text-ink-muted">{c.frp.designation ? `, ${c.frp.designation}` : ''} ({c.frp.email})</span>
        </p>
      ) : (
        <p className="text-ink-muted">{can.assignFrp ? 'Not assigned yet. Assign the employee who will investigate this complaint.' : 'Not assigned yet.'}</p>
      )}
      {history.data?.length > 0 && (
        <details className="mt-3" open={history.data.length > 1}>
          <summary className="cursor-pointer text-sm text-ink-muted">Assignment history ({history.data.length})</summary>
          <ol className="mt-2 space-y-2">
            {history.data.map((a) => (
              <li key={a._id} className="rounded border border-line px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{a.assignee?.name}</span>
                  {a.active ? <Badge tone="ok">Current</Badge> : <Badge>Ended</Badge>}
                </div>
                <p className="text-ink-muted">
                  Assigned by {a.assignedBy?.name} on {formatDateTime(a.assignedAt)}
                  {a.endedAt ? `; ended ${formatDateTime(a.endedAt)} by ${a.endedBy?.name}` : ''}.
                </p>
                {a.reason && <p className="text-ink-muted">Reason: {a.reason}</p>}
              </li>
            ))}
          </ol>
        </details>
      )}
      <AssignFrpModal open={open} complaint={c} onClose={() => setOpen(false)}
        onDone={(next, person) => {
          setOpen(false);
          onChanged(next);
          if (next.unchanged) notify(`${person?.name} is already the First Responsible Person.`);
          else notify(`${person?.name} assigned. An email with the complaint details is being sent.`);
        }} />
    </section>
  );
}

/* ---------------- tab ---------------- */

export function D2Tab({ detail, onSaved, refreshKey }) {
  const { complaint: c, can } = detail;
  const notify = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => toForm(c));
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lists, setLists] = useState(null);

  useEffect(() => {
    if (editing && !lists) lookupApi.all().then((r) => setLists(r.data.lists)).catch(() => setLists({ manufacturingLocation: [], locationDetail: [], typeOfFailure: [] }));
  }, [editing, lists]);

  if (['SUBMITTED', 'D1_ACK_PENDING', 'D1_ACKNOWLEDGED'].includes(c.status)) {
    return (
      <p className="text-ink-muted">
        {c.status === 'D1_ACKNOWLEDGED'
          ? 'D1 is acknowledged. Start D2 from the next-step panel to verify the product, record the preliminary investigation and assign the First Responsible Person.'
          : 'D2 opens after the complaint is acknowledged in D1.'}
      </p>
    );
  }

  const save = async () => {
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      const res = await complaintApi.updateD2(c._id, { version: c.__v, ...toBody(form) });
      notify('D2 information saved.');
      setEditing(false);
      onSaved(res.data);
    } catch (err) {
      const e = readError(err);
      setErrors(e.fields);
      setMessage(Object.keys(e.fields).length ? 'Some fields need attention.' : e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {can.editD2 ? (
          <p className="text-sm text-ink-muted">Fields marked * are needed before D2 can be completed.</p>
        ) : (
          <p className="flex items-center gap-1.5 text-sm text-ink-muted">
            <Lock className="h-3.5 w-3.5" aria-hidden />
            {c.status === 'D2_IN_PROGRESS' ? 'Your role can view but not edit D2.' : 'D2 information is locked after D2 is completed.'}
          </p>
        )}
        {can.editD2 && !editing && (
          <Button size="sm" icon={Pencil} onClick={() => { setForm(toForm(c)); setErrors({}); setMessage(null); setEditing(true); }}>Edit D2</Button>
        )}
      </div>

      {editing ? (
        <div>
          {message && <p className="mb-4 rounded border border-bad/20 bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">{message}</p>}
          {lists ? <D2Form form={form} setForm={setForm} errors={errors} lists={lists} /> : <Loading label="Loading lists" />}
          <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={save}>Save D2 information</Button>
          </div>
        </div>
      ) : (
        <D2View c={c} />
      )}

      <FrpSection detail={detail} onChanged={onSaved} refreshKey={refreshKey} />

      {/* FRP Acknowledgement Section (Exclusively visible to FRP or Admin - PDF Page 6 & 7) */}
      <section className="rounded border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-800">
          v Acknowledgement (FRP Only)
        </h3>
        <p className="text-xs text-slate-500 mb-3">
          This section allows the assigned First Responsible Person to formally acknowledge the complaint and begin D3 analysis.
        </p>

        {c.d2?.frpAcknowledgement?.acknowledged ? (
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center gap-1.5 text-emerald-700 font-semibold">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">✓</span>
              <span>D2 Acknowledged</span>
            </div>
            <p className="text-slate-600">
              Comments: {c.d2.frpAcknowledgement.comments || 'Acknowledged'}
            </p>
          </div>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const comments = e.target.ackComments.value;
              try {
                const res = await complaintApi.frpAcknowledge(c._id, { comments });
                notify('D2 Acknowledged by FRP. Complaint moved to D3.');
                onSaved(res.data);
              } catch (err) {
                notify(readError(err).message, 'bad');
              }
            }}
            className="space-y-3"
          >
            <div className="flex items-center gap-2">
              <input type="checkbox" id="frpAckCheck" required className="h-4 w-4 rounded text-blue-600 border-slate-300" />
              <label htmlFor="frpAckCheck" className="text-xs font-semibold text-slate-800 cursor-pointer">
                D2 Acknowledgement
              </label>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">D2 Acknowledgement Comments</label>
              <input
                type="text"
                name="ackComments"
                placeholder="Acknowledged"
                defaultValue="Acknowledged"
                className="w-full text-xs rounded border border-slate-300 p-2 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <Button type="submit" size="sm">
              Submit FRP Acknowledgement
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}
