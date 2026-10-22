import mongoose from 'mongoose';

const { Schema } = mongoose;

const whyStepSchema = new Schema(
  {
    level: { type: Number, required: true, min: 1, max: 10 },
    why: { type: String, trim: true, maxlength: 1000 },
    because: { type: String, trim: true, maxlength: 2000 },
  },
  { _id: true },
);

/** One analysis per complaint; method selected in the D3 stage selector. */
const rcaSchema = new Schema(
  {
    complaint: { type: Schema.Types.ObjectId, ref: 'Complaint', required: true },
    methods: { type: [String], enum: ['WHY_WHY', 'FISHBONE'], default: [] },
    problemStatement: { type: String, trim: true, maxlength: 2000 },
    whyWhy: { type: [whyStepSchema], default: [] },
    status: {
      type: String,
      enum: ['DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'APPROVED'],
      default: 'DRAFT',
    },
    submissionCount: { type: Number, default: 0 },
    lastSubmittedAt: { type: Date },
    lastSubmittedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, optimisticConcurrency: true },
);

rcaSchema.index({ complaint: 1 }, { unique: true });

export default mongoose.model('RootCauseAnalysis', rcaSchema);
