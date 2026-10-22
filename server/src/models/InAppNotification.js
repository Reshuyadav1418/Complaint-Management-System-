import mongoose from 'mongoose';

const { Schema } = mongoose;

const inAppNotificationSchema = new Schema(
  {
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    complaint: { type: Schema.Types.ObjectId, ref: 'Complaint' },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    link: { type: String, trim: true },
    read: { type: Boolean, default: false, index: true },
    readAt: { type: Date },
  },
  { timestamps: true }
);

inAppNotificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });

export default mongoose.model('InAppNotification', inAppNotificationSchema);
