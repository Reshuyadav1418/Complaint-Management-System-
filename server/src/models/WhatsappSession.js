import mongoose from 'mongoose';

/**
 * Chatbot conversation state per sender. Expires after 24h of inactivity,
 * matching WhatsApp's customer-service window; "Hi" restarts it.
 */
const whatsappSessionSchema = new mongoose.Schema(
  {
    waId: { type: String, required: true },
    step: { type: String, required: true, default: 'START' },
    answers: { type: mongoose.Schema.Types.Mixed, default: {} },
    lastInboundAt: { type: Date, default: Date.now },
  },
  { timestamps: true, versionKey: false },
);

whatsappSessionSchema.index({ waId: 1 }, { unique: true });
whatsappSessionSchema.index({ lastInboundAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

export default mongoose.model('WhatsappSession', whatsappSessionSchema);
