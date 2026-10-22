import mongoose from 'mongoose';
import { z } from 'zod';

export const objectId = z
  .string()
  .refine((v) => mongoose.isValidObjectId(v) && /^[a-f0-9]{24}$/i.test(v), 'Invalid id.');

export const idParams = z.object({ id: objectId });

export const pageQuery = {
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
};

/**
 * Password policy: 10–128 characters with at least one letter and one digit.
 * Length matters more than symbol rules; adjust to company IT policy.
 */
export const password = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(128, 'Use at most 128 characters.')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Include at least one letter and one number.');

export const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));
