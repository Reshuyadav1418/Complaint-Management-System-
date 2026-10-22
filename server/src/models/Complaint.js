import mongoose from 'mongoose';
import { STATUSES, STAGES, ORIGINS, REPORTER_TYPES } from '../config/workflow.js';

const { Schema } = mongoose;

/** A value paired with its score, used by the D2 preliminary investigation. */
const scoredValue = new Schema(
  {
    value: { type: String, trim: true, maxlength: 200 },
    score: { type: Number, min: 0 },
  },
  { _id: false },
);

const complaintSchema = new Schema(
  {
    complaintNumber: { type: String, required: true, immutable: true },
    complaintDate: { type: Date, required: true, default: Date.now },
    origin: { type: String, enum: ORIGINS, required: true },

    // ---- D1: requester ----
    requester: {
      name: { type: String, required: true, trim: true, maxlength: 120 },
      email: { type: String, trim: true, lowercase: true, maxlength: 254 },
      mobile: { type: String, trim: true, maxlength: 20 },
      type: { type: String, enum: REPORTER_TYPES },
    },
    sbu: { type: String, required: true, trim: true, maxlength: 80 },
    country: { type: String, required: true, trim: true, maxlength: 80 },
    headQuarter: { type: String, trim: true, maxlength: 120 },
    shortDescription: { type: String, required: true, trim: true, maxlength: 500 },
    additionalRemarks: { type: String, trim: true, maxlength: 4000 },
    category: { type: String, trim: true, maxlength: 120 },

    // ---- D1: customer ----
    customer: {
      name: { type: String, trim: true, maxlength: 200 }, // Distributor/Retailer name
      code: { type: String, trim: true, maxlength: 60 },
    },

    // Product as reported. Verified values live under d2.verifiedProduct.
    reportedProduct: {
      name: { type: String, trim: true, maxlength: 200 },
      batchNumber: { type: String, trim: true, maxlength: 60 },
    },

    // ---- D1: acknowledgement ----
    acknowledgement: {
      approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      approvedAt: { type: Date },
      remarks: { type: String, trim: true, maxlength: 2000 },
    },

    // ---- D2 ----
    d2: {
      verifiedProduct: {
        performanceRelated: { type: Boolean },
        productName: { type: String, trim: true, maxlength: 200 },
        batchNumber: { type: String, trim: true, maxlength: 60 },
        sku: { type: String, trim: true, maxlength: 60 },
        invoiceQuantity: { type: Number, min: 0 },
        remarks: { type: String, trim: true, maxlength: 2000 },
      },
      investigation: {
        occurrences: scoredValue, // A
        affectedQuantity: scoredValue, // B
        severity: scoredValue, // C
        // Stored as entered/computed by the confirmed rule. The formula is an
        // open question (docs/OPEN_QUESTIONS.md, Q5); nothing computes it yet.
        rpn: { type: Number, min: 0 },
        manufacturingLocation: { type: String, trim: true, maxlength: 120 },
        locationDetail: { type: String, trim: true, maxlength: 200 },
        repeatComplaint: { type: Boolean },
        typeOfFailure: { type: String, trim: true, maxlength: 120 },
        slaHoursD3: { type: Number, min: 0 },
        slaHoursD4: { type: Number, min: 0 },
      },
      sendMailToFrp: { type: Boolean, default: false },
      slaExtension: {
        requestedHours: { type: Number, min: 1 },
        reason: { type: String, trim: true, maxlength: 1000 },
        requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        requestedAt: { type: Date },
        status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
      },
      frpAcknowledgement: {
        acknowledged: { type: Boolean, default: false },
        comments: { type: String, trim: true, maxlength: 2000 },
        acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        acknowledgedAt: { type: Date },
      },
      completedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      completedAt: { type: Date },
    },

    // ---- D4 ----
    d4: {
      copq: {
        logisticsCost: { type: Number, min: 0, default: 0 },
        testingCost: { type: Number, min: 0, default: 0 },
        reprocessingCost: { type: Number, min: 0, default: 0 },
        totalCost: { type: Number, min: 0, default: 0 },
      },
      completedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      completedAt: { type: Date },
    },

    // Current FRP, denormalised for fast listing. Full history lives in
    // complaintassignments.
    frp: { type: Schema.Types.ObjectId, ref: 'User' },

    priority: { type: String, enum: ['Low', 'Medium', 'High', 'Critical'] },
    stage: { type: String, enum: Object.values(STAGES), default: STAGES.D1, required: true },
    status: { type: String, enum: Object.values(STATUSES), default: STATUSES.SUBMITTED, required: true },
    stageDueAt: { type: Date }, // set once SLA rules are confirmed
    closedAt: { type: Date },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' }, // null for WhatsApp
    lastActivityAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    // Optimistic concurrency: two people saving the same complaint at once
    // get a conflict instead of silently overwriting each other.
    optimisticConcurrency: true,
  },
);

complaintSchema.index({ complaintNumber: 1 }, { unique: true });
complaintSchema.index({ status: 1, stage: 1, lastActivityAt: -1 });
complaintSchema.index({ frp: 1, status: 1 });
// Match the list's sort orders (with _id as tie-breaker) so a page of 20 reads
// 20 index entries instead of sorting the whole collection.
complaintSchema.index({ lastActivityAt: -1, _id: -1 });
complaintSchema.index({ complaintDate: -1, _id: -1 });
complaintSchema.index({ stageDueAt: 1 }, { partialFilterExpression: { stageDueAt: { $type: 'date' } } });
complaintSchema.index({ createdAt: -1 });
complaintSchema.index({ sbu: 1, country: 1 });
complaintSchema.index({ 'reportedProduct.name': 1 });
complaintSchema.index({ 'reportedProduct.batchNumber': 1 });
complaintSchema.index({ 'd2.verifiedProduct.batchNumber': 1 });

// __v is kept in JSON so the client can send it back for conflict checks.
complaintSchema.set('toJSON', { versionKey: true });

export default mongoose.model('Complaint', complaintSchema);
