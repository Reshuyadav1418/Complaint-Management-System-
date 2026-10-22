import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Append-only record of who did what. Nothing in the application updates or
 * deletes audit entries; there is no route that can.
 */
const auditLogSchema = new Schema(
  {
    at: { type: Date, default: Date.now, required: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User' }, // null for system/WhatsApp
    actorName: { type: String },
    actorType: { type: String, enum: ['user', 'system', 'reporter'], default: 'user' },
    action: { type: String, required: true }, // e.g. 'user.create', 'complaint.d1.acknowledge'
    entityType: { type: String, required: true }, // 'User', 'Complaint', ...
    entityId: { type: Schema.Types.ObjectId },
    complaint: { type: Schema.Types.ObjectId, ref: 'Complaint' },
    summary: { type: String, maxlength: 500 },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    // Internal entries are never shown to external reporters.
    visibility: { type: String, enum: ['internal', 'external'], default: 'internal' },
    ip: { type: String },
    userAgent: { type: String },
  },
  { versionKey: false },
);

auditLogSchema.index({ complaint: 1, at: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1, at: -1 });
auditLogSchema.index({ actor: 1, at: -1 });
auditLogSchema.index({ action: 1, at: -1 });

export default mongoose.model('AuditLog', auditLogSchema);
