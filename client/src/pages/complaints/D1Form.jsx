import { Field } from '../../components/Field.jsx';
import { ORIGINS, REPORTER_TYPES } from '../../lib/complaints.js';

/** yyyy-mm-dd in the user's own time zone (toISOString would use UTC). */
export function localDay(d = new Date()) {
  return new Date(d).toLocaleDateString('en-CA');
}

/** Form state <-> API body. Dates are yyyy-mm-dd in the form. */
export function toForm(c = {}) {
  return {
    origin: c.origin || 'Phone',
    complaintDate: localDay(c.complaintDate || new Date()),
    requester: { name: c.requester?.name || '', email: c.requester?.email || '', mobile: c.requester?.mobile || '', type: c.requester?.type || '' },
    sbu: c.sbu || '',
    country: c.country || '',
    headQuarter: c.headQuarter || '',
    category: c.category || '',
    customer: { name: c.customer?.name || '', code: c.customer?.code || '' },
    reportedProduct: { name: c.reportedProduct?.name || '', batchNumber: c.reportedProduct?.batchNumber || '' },
    shortDescription: c.shortDescription || '',
    additionalRemarks: c.additionalRemarks || '',
  };
}

/**
 * The date input holds only a day. When editing, the stored date-time is
 * sent back unchanged unless the user picked a different day; otherwise every
 * save would quietly reset the time of receipt to midnight.
 */
export function toBody(form, { includeOrigin, original }) {
  const { origin, requester, complaintDate, ...rest } = form;
  const body = { ...rest, requester: { ...requester, type: requester.type || undefined } };
  if (includeOrigin) body.origin = origin;
  if (!original || complaintDate !== localDay(original.complaintDate)) {
    // A newly chosen day is stored as local midnight of that day.
    body.complaintDate = new Date(`${complaintDate}T00:00:00`).toISOString();
  }
  // A new complaint dated today keeps the actual time of registration.
  if (!original && complaintDate === localDay()) delete body.complaintDate;
  return body;
}

function Section({ title, children }) {
  return (
    <fieldset className="border-t border-line pt-4 first:border-0 first:pt-0">
      <legend className="mb-3 bg-surface pr-2 font-semibold">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

/**
 * D1 fields from the brief: requester information, customer information and
 * the complaint itself. The option lists for SBU, country, category and head
 * quarter are free text until the company's lists are confirmed (Q6).
 */
export function D1Form({ value, onChange, errors = {}, showOrigin = false }) {
  const field = (path) => {
    const [a, b] = path.split('.');
    return {
      value: b ? value[a][b] : value[a],
      onChange: (e) => onChange(b ? { ...value, [a]: { ...value[a], [b]: e.target.value } } : { ...value, [a]: e.target.value }),
    };
  };
  const err = (path) => errors[path];

  return (
    <div className="space-y-5">
      <Section title="Complaint">
        {showOrigin && (
          <Field label="Received by" required error={err('origin')}>
            {(p) => (
              <select {...p} className="field-input" {...field('origin')}>
                {ORIGINS.map((o) => <option key={o}>{o}</option>)}
              </select>
            )}
          </Field>
        )}
        <Field label="Complaint date" required error={err('complaintDate')}>
          {(p) => <input {...p} type="date" max={localDay()} className="field-input" {...field('complaintDate')} />}
        </Field>
        <Field label="SBU" required error={err('sbu')} hint="e.g. AHP-Rumicare">
          {(p) => <input {...p} className="field-input" {...field('sbu')} />}
        </Field>
        <Field label="Country" required error={err('country')}>
          {(p) => <input {...p} className="field-input" autoComplete="country-name" {...field('country')} />}
        </Field>
        <Field label="Complaint head quarter" error={err('headQuarter')}>
          {(p) => <input {...p} className="field-input" {...field('headQuarter')} />}
        </Field>
        <Field label="Category" error={err('category')}>
          {(p) => <input {...p} className="field-input" {...field('category')} />}
        </Field>
        <Field label="Short description of the complaint" required error={err('shortDescription')} className="sm:col-span-2">
          {(p) => <textarea {...p} rows={2} maxLength={500} className="field-input" {...field('shortDescription')} />}
        </Field>
        <Field label="Additional remarks" error={err('additionalRemarks')} className="sm:col-span-2">
          {(p) => <textarea {...p} rows={3} maxLength={4000} className="field-input" {...field('additionalRemarks')} />}
        </Field>
      </Section>

      <Section title="Requester">
        <Field label="Requested by" required error={err('requester.name')}>
          {(p) => <input {...p} className="field-input" {...field('requester.name')} />}
        </Field>
        <Field label="Reporter type" error={err('requester.type')}>
          {(p) => (
            <select {...p} className="field-input" {...field('requester.type')}>
              <option value="">Not stated</option>
              {REPORTER_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          )}
        </Field>
        <Field label="Requester email" error={err('requester.email')} hint="Needed to send the acknowledgement email.">
          {(p) => <input {...p} type="email" className="field-input" {...field('requester.email')} />}
        </Field>
        <Field label="Requester mobile number" error={err('requester.mobile')}>
          {(p) => <input {...p} type="tel" className="field-input" {...field('requester.mobile')} />}
        </Field>
      </Section>

      <Section title="Customer and product">
        <Field label="Distributor / retailer name" error={err('customer.name')}>
          {(p) => <input {...p} className="field-input" {...field('customer.name')} />}
        </Field>
        <Field label="Customer code" error={err('customer.code')}>
          {(p) => <input {...p} className="field-input" {...field('customer.code')} />}
        </Field>
        <Field label="Product (as reported)" error={err('reportedProduct.name')}>
          {(p) => <input {...p} className="field-input" {...field('reportedProduct.name')} />}
        </Field>
        <Field label="Batch number (as reported)" error={err('reportedProduct.batchNumber')} hint="Verified in D2.">
          {(p) => <input {...p} className="field-input" {...field('reportedProduct.batchNumber')} />}
        </Field>
      </Section>
    </div>
  );
}
