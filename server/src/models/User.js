import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import env from '../config/env.js';

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    employeeId: { type: String, trim: true, maxlength: 40 },
    phone: { type: String, trim: true, maxlength: 20 },
    designation: { type: String, trim: true, maxlength: 120 },
    department: { type: Schema.Types.ObjectId, ref: 'Department' },
    roles: { type: [String], default: ['employee'] },

    passwordHash: { type: String, required: true, select: false },
    mustChangePassword: { type: Boolean, default: true },
    passwordChangedAt: { type: Date },

    isActive: { type: Boolean, default: true },
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },
    // Incremented to invalidate every existing session for this user.
    tokenVersion: { type: Number, default: 0, select: false },
    lastLoginAt: { type: Date },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ employeeId: 1 }, { unique: true, partialFilterExpression: { employeeId: { $type: 'string' } } });
userSchema.index({ roles: 1, isActive: 1 });
userSchema.index({ name: 'text', email: 'text', employeeId: 'text' });

userSchema.methods.setPassword = async function setPassword(plain) {
  this.passwordHash = await bcrypt.hash(plain, env.BCRYPT_ROUNDS);
  this.passwordChangedAt = new Date();
};

userSchema.methods.verifyPassword = function verifyPassword(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.methods.isLocked = function isLocked(now = new Date()) {
  return Boolean(this.lockUntil && this.lockUntil > now);
};

userSchema.set('toJSON', {
  versionKey: false,
  transform(_doc, ret) {
    delete ret.passwordHash;
    delete ret.failedLoginAttempts;
    delete ret.lockUntil;
    delete ret.tokenVersion;
    return ret;
  },
});

export default mongoose.model('User', userSchema);
