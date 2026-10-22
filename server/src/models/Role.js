import mongoose from 'mongoose';
import { ALL_PERMISSIONS } from '../auth/permissions.js';

const roleSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, match: /^[a-z][a-z0-9_]{1,39}$/ },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 300 },
    permissions: {
      type: [String],
      default: [],
      validate: {
        validator: (list) => list.every((p) => ALL_PERMISSIONS.includes(p)),
        message: 'Unknown permission in list.',
      },
    },
    // System roles cannot be deleted or renamed; their permissions can change.
    isSystem: { type: Boolean, default: false },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

roleSchema.index({ key: 1 }, { unique: true });
roleSchema.set('toJSON', { versionKey: false });

export default mongoose.model('Role', roleSchema);
