import mongoose from 'mongoose';
import { STATUSES } from '../config/workflow.js';

const { Schema } = mongoose;

const statusHistorySchema = new Schema(
  {
    complaint: { type: Schema.Types.ObjectId, ref: 'Complaint', required: true },
    fromStatus: { type: String, enum: [...Object.values(STATUSES), null] },
    toStatus: { type: String, enum: Object.values(STATUSES), required: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
    remarks: { type: String, trim: true, maxlength: 2000 },
    // Client-supplied key; a retried transition with the same key is a no-op.
    idempotencyKey: { type: String },
  },
  { versionKey: false },
);

statusHistorySchema.index({ complaint: 1, at: 1 });
statusHistorySchema.index(
  { complaint: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

export default mongoose.model('ComplaintStatusHistory', statusHistorySchema);
