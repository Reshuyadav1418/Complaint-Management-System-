import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * One row per assignment. Reassignment closes the active row and opens a new
 * one, so the full history is kept. The partial unique index guarantees at
 * most one active assignment per complaint and role, which also makes a
 * retried "assign" request unable to create a duplicate.
 */
const assignmentSchema = new Schema(
  {
    complaint: { type: Schema.Types.ObjectId, ref: 'Complaint', required: true },
    role: { type: String, enum: ['FRP', 'REVIEWER'], required: true },
    assignee: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    assignedAt: { type: Date, default: Date.now },
    active: { type: Boolean, default: true },
    endedAt: { type: Date },
    endedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String, trim: true, maxlength: 1000 },
  },
  { versionKey: false },
);

assignmentSchema.index(
  { complaint: 1, role: 1 },
  { unique: true, partialFilterExpression: { active: true }, name: 'one_active_assignment' },
);
assignmentSchema.index({ assignee: 1, active: 1 });
assignmentSchema.index({ complaint: 1, assignedAt: -1 });

export default mongoose.model('ComplaintAssignment', assignmentSchema);
