import { z } from 'zod';
import { objectId, pageQuery } from './common.js';
import { REPORTER_TYPES, STATUSES, STAGES } from '../config/workflow.js';

const text = (max) => z.string().trim().max(max);
// In a new complaint an empty optional field is simply absent. In an edit,
// an emptied field must be cleared, so it becomes null.
const optional = (max, empty) =>
  text(max)
    .optional()
    .nullable()
    .transform((v) => (v === '' ? empty : v));

const blankTo = (empty) => (v) => (typeof v === 'string' && v.trim() === '' ? empty : v);

const mobile = (empty) =>
  z.preprocess(
    blankTo(empty),
    z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid mobile number.').nullable().optional(),
  );

const notInFuture = z.coerce
  .date('Enter a valid date.')
  .refine((d) => d.getTime() <= Date.now() + 5 * 60 * 1000, 'The complaint date cannot be in the future.');

/** D1 fields, shared by registration and D1 edit. */
const d1Fields = (empty) => ({
  complaintDate: notInFuture.optional(),
  requester: z.object({
    name: text(120).min(2, 'Enter the requester’s name.'),
    email: z.preprocess(
      blankTo(empty),
      z.email('Enter a valid email address.').max(254).transform((v) => v.toLowerCase()).nullable().optional(),
    ),
    mobile: mobile(empty),
    type: z.enum(REPORTER_TYPES, 'Choose Customer, Retailer or Distributor.').optional(),
  }),
  sbu: text(80).min(1, 'Enter the SBU.'),
  country: text(80).min(1, 'Enter the country.'),
  headQuarter: optional(120, empty),
  shortDescription: text(500).min(5, 'Describe the complaint in at least 5 characters.'),
  additionalRemarks: optional(4000, empty),
  category: optional(120, empty),
  customer: z.object({ name: optional(200, empty), code: optional(60, empty) }).optional(),
  reportedProduct: z.object({ name: optional(200, empty), batchNumber: optional(60, empty) }).optional(),
});

// Staff-entered complaints. WhatsApp complaints are created by the webhook.
export const createComplaintBody = z.object({
  ...d1Fields(undefined),
  origin: z.enum(['Web', 'Email', 'Phone'], 'Choose how the complaint was received.'),
});

export const updateD1Body = z
  .object({ ...d1Fields(null), version: z.number().int().min(0) })
  .partial()
  .required({ version: true });

const csv = (values) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
    .pipe(z.array(z.enum(values)).optional());

const flag = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');

export const listComplaintsQuery = z.object({
  ...pageQuery,
  search: z.string().trim().max(100).optional(),
  status: csv(Object.values(STATUSES)),
  stage: z.enum(Object.values(STAGES)).optional(),
  sbu: z.string().trim().max(80).optional(),
  country: z.string().trim().max(80).optional(),
  origin: z.enum(['WhatsApp', 'Web', 'Email', 'Phone']).optional(),
  frp: objectId.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  mine: flag,
  open: flag,
  overdue: flag,
  sort: z.enum(['number', 'date', 'updated', 'status', 'sbu', 'country']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

export const attachmentParams = z.object({ id: objectId, attachmentId: objectId });
export const uploadBody = z.object({ stage: z.enum(['SYNCED', 'D1', 'D2', 'D3', 'D4']).optional() });

export const acknowledgeBody = z.object({
  remarks: z.string().trim().max(2000).optional(),
  // Sent by the client so a retried request (e.g. after a timeout) is harmless.
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/).optional(),
});

/* ---------------- D2 (Phase 5) ---------------- */

const blankToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);
const d2Text = (max) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());
const d2Number = (max, label) =>
  z.preprocess(
    (v) => (v === '' || v === undefined ? null : v),
    z.coerce.number(`Enter a number for ${label}.`).min(0, `${label} cannot be negative.`).max(max, `${label} is too large.`).nullable().optional(),
  );
const yesNo = z.preprocess((v) => (v === '' ? null : v), z.boolean().nullable().optional());
const scored = (label) =>
  z
    .object({ value: d2Text(200), score: d2Number(1000, `${label} score`) })
    .optional();

export const updateD2Body = z.object({
  version: z.number().int().min(0),
  priority: z.preprocess(blankToNull, z.enum(['Low', 'Medium', 'High', 'Critical']).nullable().optional()),
  verifiedProduct: z
    .object({
      performanceRelated: yesNo,
      productName: d2Text(200),
      batchNumber: d2Text(60),
      sku: d2Text(60),
      invoiceQuantity: d2Number(10_000_000, 'Invoice quantity'),
      remarks: d2Text(2000),
    })
    .optional(),
  investigation: z
    .object({
      occurrences: scored('Occurrence'),
      affectedQuantity: scored('Affected quantity'),
      severity: scored('Severity'),
      rpn: d2Number(1_000_000, 'RPN'),
      manufacturingLocation: d2Text(120),
      locationDetail: d2Text(200),
      repeatComplaint: yesNo,
      typeOfFailure: d2Text(120),
      slaHoursD3: d2Number(10_000, 'SLA hours for D3'),
      slaHoursD4: d2Number(10_000, 'SLA hours for D4'),
    })
    .optional(),
});

export const assignFrpBody = z.object({
  assigneeId: objectId,
  reason: z.string().trim().max(1000).optional(),
});

export const stageActionBody = z.object({
  remarks: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/).optional(),
});

/* ---------------- D3 (Phase 6) ---------------- */

const FISHBONE = ['Manpower', 'Method', 'Machine', 'Material', 'Measurement', 'Mother Nature'];
const category = z.enum(FISHBONE, 'Choose one of the six fishbone categories.');

export const analysisBody = z.object({
  version: z.number().int().min(0),
  methods: z.array(z.enum(['WHY_WHY', 'FISHBONE'])).max(2).optional(),
  problemStatement: z.string().trim().max(2000).optional(),
  whyWhy: z
    .array(z.object({ why: z.string().trim().max(1000), because: z.string().trim().max(2000) }))
    .max(10, 'Record at most 10 levels.')
    .optional(),
});

export const causeBody = z.object({
  category: category.optional(),
  text: z.string().trim().min(2, 'Describe the cause.').max(300),
  parent: objectId.optional(),
});
export const causePatch = z
  .object({ category, text: z.string().trim().min(2, 'Describe the cause.').max(300) })
  .partial()
  .refine((v) => Object.keys(v).length, 'Nothing to update.');

export const rootCauseBody = z.object({
  category,
  description: z.string().trim().min(5, 'Describe the root cause in at least 5 characters.').max(2000),
  sourceCause: objectId.optional(),
});
export const rootCausePatch = rootCauseBody.omit({ sourceCause: true }).partial().refine((v) => Object.keys(v).length, 'Nothing to update.');

const optionalLong = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(max).optional());
const capaFields = {
  capaRequired: z.boolean('Say whether CAPA is required.'),
  category: optionalLong(120),
  description: optionalLong(2000),
  correctiveAction: optionalLong(2000),
  preventiveAction: optionalLong(2000),
  responsiblePerson: z.preprocess((v) => (v === '' ? undefined : v), objectId.optional()),
  targetDate: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.date('Enter a valid date.').optional()),
  actionStatus: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'NOT_REQUIRED']).optional(),
};
export const capaBody = z.object(capaFields);
export const capaPatch = z
  .object({ ...capaFields, version: z.number().int().min(0) })
  .partial()
  .refine((v) => Object.keys(v).length, 'Nothing to update.');

export const subIdParams = (name) => z.object({ id: objectId, [name]: objectId });

/* ---------------- D3 review (Phase 7) ---------------- */

export const submitD3Body = z.object({
  reviewerId: objectId,
  remarks: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/).optional(),
});
