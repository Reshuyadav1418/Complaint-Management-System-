import mongoose from 'mongoose';
import { FISHBONE_CATEGORIES } from './FishboneCause.js';

const { Schema } = mongoose;

const rootCauseSchema = new Schema(
  {
    complaint: { type: Schema.Types.ObjectId, ref: 'Complaint', required: true },
    analysis: { type: Schema.Types.ObjectId, ref: 'RootCauseAnalysis', required: true },
    category: { type: String, enum: FISHBONE_CATEGORIES, required: true },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    sourceCause: { type: Schema.Types.ObjectId, ref: 'FishboneCause' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

rootCauseSchema.index({ complaint: 1 });
rootCauseSchema.index({ category: 1 });

export default mongoose.model('RootCause', rootCauseSchema);
