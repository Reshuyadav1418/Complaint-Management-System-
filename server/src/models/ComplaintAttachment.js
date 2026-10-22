import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Metadata only. File bytes live in private object storage under storageKey
 * and are served through short-lived signed URLs after a permission check.
 */
const attachmentSchema = new Schema(
  {
    complaint: { type: Schema.Types.ObjectId, ref: 'Complaint', required: true },
    stage: { type: String, enum: ['D1', 'D2', 'D3', 'D4', 'SYNCED'], required: true },
    linkedTo: {
      kind: { type: String, enum: ['Complaint', 'CapaRecord', 'RootCause'] },
      id: { type: Schema.Types.ObjectId },
    },
    storageKey: { type: String, required: true },
    originalName: { type: String, required: true, maxlength: 255 },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true, min: 0 },
    sha256: { type: String },
    source: { type: String, enum: ['upload', 'whatsapp'], default: 'upload' },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

attachmentSchema.index({ complaint: 1, stage: 1 });
attachmentSchema.index({ storageKey: 1 }, { unique: true });

export default mongoose.model('ComplaintAttachment', attachmentSchema);
