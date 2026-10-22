import mongoose from 'mongoose';

const { Schema } = mongoose;

export const NOTIFICATION_TYPES = Object.freeze([
  'D1_ACKNOWLEDGEMENT',
  'D2_FRP_ASSIGNED',
  'D2_COMPLETED',
  'D3_APPROVAL_REQUEST',
  'D3_REJECTED',
  'D4_NOTICE',
  'CLOSURE',
  'WHATSAPP_COMPLAINT_REGISTERED',
  'WHATSAPP_STATUS_UPDATE',
]);

/**
 * Every outbound email or WhatsApp message. dedupeKey is unique, so the
 * same business event can never queue the same notification twice.
 * 'SENT' means the provider accepted it; 'DELIVERED' is only set when the
 * provider reports delivery (WhatsApp does; plain SMTP does not).
 */
const notificationSchema = new Schema(
  {
    complaint: { type: Schema.Types.ObjectId, ref: 'Complaint' },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    channel: { type: String, enum: ['email', 'whatsapp'], required: true },
    recipient: { type: String, required: true },
    recipientUser: { type: Schema.Types.ObjectId, ref: 'User' },
    subject: { type: String },
    // Rendered once at queue time, so every retry sends exactly the same
    // message and the log shows what the recipient received.
    bodyText: { type: String },
    bodyHtml: { type: String, select: false },
    dedupeKey: { type: String, required: true },
    status: { type: String, enum: ['QUEUED', 'SENT', 'DELIVERED', 'FAILED'], default: 'QUEUED' },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    // Set while a worker is sending, so two workers never send the same email.
    lockedUntil: { type: Date },
    lastError: { type: String, maxlength: 2000 },
    providerMessageId: { type: String },
    sentAt: { type: Date },
    deliveredAt: { type: Date },
    retriedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, versionKey: false },
);

notificationSchema.index({ dedupeKey: 1 }, { unique: true });
notificationSchema.index({ status: 1, nextAttemptAt: 1 });
notificationSchema.index({ complaint: 1, createdAt: -1 });
notificationSchema.index({ providerMessageId: 1 }, { sparse: true });

export default mongoose.model('Notification', notificationSchema);
