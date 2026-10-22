import mongoose from 'mongoose';

const departmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    code: { type: String, required: true, trim: true, uppercase: true, match: /^[A-Z0-9_-]{2,20}$/ },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

departmentSchema.index({ code: 1 }, { unique: true });
departmentSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
departmentSchema.set('toJSON', { versionKey: false });

export default mongoose.model('Department', departmentSchema);
