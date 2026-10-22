import mongoose from 'mongoose';

/**
 * Administrator-managed option lists for dropdowns. Values are stored on the
 * complaint as text, so renaming or deactivating an option never changes
 * past complaints.
 *
 * locationDetail values belong to a manufacturingLocation (parent), so the
 * detail dropdown depends on the location chosen.
 */
export const LOOKUP_LISTS = Object.freeze({
  manufacturingLocation: { label: 'Manufacturing locations' },
  locationDetail: { label: 'Location details', parentList: 'manufacturingLocation' },
  typeOfFailure: { label: 'Types of failure' },
});

const lookupValueSchema = new mongoose.Schema(
  {
    list: { type: String, enum: Object.keys(LOOKUP_LISTS), required: true },
    value: { type: String, required: true, trim: true, maxlength: 120 },
    parent: { type: String, trim: true, maxlength: 120 },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false },
);

lookupValueSchema.index(
  { list: 1, parent: 1, value: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 }, name: 'unique_value_per_list' },
);

export default mongoose.model('LookupValue', lookupValueSchema);
