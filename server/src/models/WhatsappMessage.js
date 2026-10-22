import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Raw log of every inbound/outbound WhatsApp message. The unique index on
 * waMessageId is the duplicate-webhook guard: Meta retries deliveries, and a
 * second insert of the same id fails instead of being processed again.
 */
const whatsappMessageSchema = new Schema(
  {
    waMessageId: { type: String, required: true },
    direction: { type: String, enum: ['inbound', 'outbound'], required: true },
    waId: { type: String, required: true }, // sender/recipient phone (E.164 without +)
    type: { type: String },
    body: { type: Schema.Types.Mixed },
    complaint: { type: Schema.Types.ObjectId, ref: 'Complaint' },
    processing: {
      status: { type: String, enum: ['RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED'], default: 'RECEIVED' },
      error: { type: String },
      processedAt: { type: Date },
    },
  },
  { timestamps: true, versionKey: false },
);

whatsappMessageSchema.index({ waMessageId: 1 }, { unique: true });
whatsappMessageSchema.index({ waId: 1, createdAt: -1 });

export default mongoose.model('WhatsappMessage', whatsappMessageSchema);
