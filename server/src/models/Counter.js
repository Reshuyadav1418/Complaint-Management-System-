import mongoose from 'mongoose';

/** Atomic sequence store, e.g. { _id: 'complaint:2026', seq: 41 }. */
const counterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { versionKey: false },
);

export default mongoose.model('Counter', counterSchema);
