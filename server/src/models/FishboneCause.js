import mongoose from 'mongoose';

const { Schema } = mongoose;

// Category names from the brief. If the company's existing implementation
// uses different names, change them here (docs/OPEN_QUESTIONS.md, Q7).
export const FISHBONE_CATEGORIES = Object.freeze([
  'Manpower',
  'Method',
  'Machine',
  'Material',
  'Measurement',
  'Mother Nature',
]);

/**
 * Causes are stored as rows, not as a drawing. The fishbone diagram is
 * generated from these rows every time it is shown.
 */
const fishboneCauseSchema = new Schema(
  {
    complaint: { type: Schema.Types.ObjectId, ref: 'Complaint', required: true },
    analysis: { type: Schema.Types.ObjectId, ref: 'RootCauseAnalysis', required: true },
    category: { type: String, enum: FISHBONE_CATEGORIES, required: true },
    text: { type: String, required: true, trim: true, maxlength: 300 },
    parent: { type: Schema.Types.ObjectId, ref: 'FishboneCause' }, // sub-cause
    order: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date }, // soft delete keeps history auditable
  },
  { timestamps: true, versionKey: false },
);

fishboneCauseSchema.index({ analysis: 1, category: 1, order: 1 });
fishboneCauseSchema.index({ complaint: 1 });

export default mongoose.model('FishboneCause', fishboneCauseSchema);
