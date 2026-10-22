import { Counter } from '../models/index.js';
import env from '../config/env.js';

/** Atomically increment and return the next value for a named sequence. */
export async function nextSequence(name, session) {
  const doc = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after', session },
  );
  return doc.seq;
}

/**
 * Placeholder complaint number format: PREFIX-YYYY-NNNNNN, resetting yearly.
 * Replace once the company's approved format is known (OPEN_QUESTIONS Q1).
 * The year is taken in IST because the business operates in India.
 */
export async function nextComplaintNumber(date = new Date(), session) {
  const year = new Intl.DateTimeFormat('en-IN', { year: 'numeric', timeZone: 'Asia/Kolkata' }).format(date);
  const seq = await nextSequence(`complaint:${year}`, session);
  return `${env.COMPLAINT_NUMBER_PREFIX}-${year}-${String(seq).padStart(env.COMPLAINT_NUMBER_PAD, '0')}`;
}

/** CAPA numbers follow their complaint: CMP-2026-000041-CAPA-01. */
export async function nextCapaNumber(complaintNumber, session) {
  const seq = await nextSequence(`capa:${complaintNumber}`, session);
  return `${complaintNumber}-CAPA-${String(seq).padStart(2, '0')}`;
}
