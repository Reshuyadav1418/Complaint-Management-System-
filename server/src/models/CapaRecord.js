import mongoose from 'mongoose';

const { Schema } = mongoose;

const approvalStepSchema = new Schema(
  {
    step: { type: String, required: true },
    status: { type: String, required: true },
    assignedTo: { type: String },
    actualApprover: { type: String },
    date: { type: Date, default: Date.now },
    comments: { type: String },
  },
  { _id: false }
);

const approvalDecisionSchema = new Schema(
  {
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    comments: { type: String, trim: true },
    approver: { type: Schema.Types.ObjectId, ref: 'User' },
    date: { type: Date },
  },
  { _id: false }
);

/**
 * Corrective and Preventive Action (CAPA) record, linked to one complaint and root cause.
 * Tracks the full lifecycle across D3 RCA, Multi-Tier Approvals, Implementation, and D4 Effectiveness.
 */
const capaSchema = new Schema(
  {
    capaNumber: { type: String, required: true, immutable: true },
    complaint: { type: Schema.Types.ObjectId, ref: 'Complaint', required: true },
    rootCause: { type: Schema.Types.ObjectId, ref: 'RootCause', required: true },
    capaRequired: { type: Boolean, required: true, default: true },
    category: { type: String, trim: true, maxlength: 120 }, // 'CA' or 'PA'
    description: { type: String, trim: true, maxlength: 2000 },
    rcCategory: { type: String, trim: true },
    rcDescription: { type: String, trim: true },

    correctiveAction: { type: String, trim: true, maxlength: 2000 },
    preventiveAction: { type: String, trim: true, maxlength: 2000 },
    responsiblePerson: { type: Schema.Types.ObjectId, ref: 'User' },
    targetDate: { type: Date },

    // D3 Initial Root Cause & CAPA Approval (FRP Manager & Complaint Handler)
    frpManagerApproval: { type: approvalDecisionSchema, default: () => ({ status: 'PENDING' }) },
    handlerApproval: { type: approvalDecisionSchema, default: () => ({ status: 'PENDING' }) },

    // CAPA Implementation
    actionImplemented: { type: String, trim: true, maxlength: 2000 },
    forwardForReview: { type: Boolean, default: false },

    // Implementation Multi-Tier Approval (Case 1: auto FRP, Handler, QA; Case 2: FRP, Handler, QA)
    frpImplementationApproval: { type: approvalDecisionSchema, default: () => ({ status: 'PENDING' }) },
    handlerImplementationApproval: { type: approvalDecisionSchema, default: () => ({ status: 'PENDING' }) },
    qaImplementationApproval: { type: approvalDecisionSchema, default: () => ({ status: 'PENDING' }) },
    approvalHistory: [approvalStepSchema],

    // D4 Effectiveness Review
    erp: { type: Schema.Types.ObjectId, ref: 'User' }, // Effectiveness Responsible Person
    scheduleType: { type: String, enum: ['Timeline', 'Frequency'] },
    scheduleTimeline: { type: Date },
    scheduleFrequency: { type: String, trim: true },
    effectivenessReview: { type: String, trim: true, maxlength: 2000 },
    isClosed: { type: Boolean, default: false },
    closedAt: { type: Date },

    actionStatus: {
      type: String,
      enum: ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'NOT_REQUIRED'],
      default: 'NOT_STARTED',
    },
    reviewStatus: { type: String, enum: ['NOT_SUBMITTED', 'SUBMITTED', 'REVIEWED'], default: 'NOT_SUBMITTED' },
    approvalStatus: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },

    evidence: [{ type: Schema.Types.ObjectId, ref: 'ComplaintAttachment' }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date },
  },
  { timestamps: true, optimisticConcurrency: true }
);

capaSchema.index({ capaNumber: 1 }, { unique: true });
capaSchema.index({ complaint: 1 });
capaSchema.index({ rootCause: 1 });
capaSchema.index({ responsiblePerson: 1, actionStatus: 1 });
capaSchema.index({ erp: 1 });

export default mongoose.model('CapaRecord', capaSchema);
