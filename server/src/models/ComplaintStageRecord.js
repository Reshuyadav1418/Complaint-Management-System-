import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Decisions taken at a stage: acknowledgements, submissions, approvals,
 * rejections. A snapshot of the submitted data is stored so a rejected
 * version stays readable after the user edits and resubmits.
 */
const stageRecordSchema = new Schema(
  {
    complaint: { type: Schema.Types.ObjectId, ref: 'Complaint', required: true },
    stage: { type: String, enum: ['D1', 'D2', 'D3', 'D4'], required: true },
    kind: {
      type: String,
      enum: ['ACKNOWLEDGEMENT', 'COMPLETION', 'SUBMISSION', 'APPROVAL', 'REJECTION'],
      required: true,
    },
    actor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    at: { type: Date, default: Date.now },
    remarks: { type: String, trim: true, maxlength: 4000 },
    version: { type: Number }, // submission number for D3/D4 cycles
    snapshot: { type: Schema.Types.Mixed },
  },
  { versionKey: false },
);

stageRecordSchema.index({ complaint: 1, stage: 1, at: 1 });

export default mongoose.model('ComplaintStageRecord', stageRecordSchema);
