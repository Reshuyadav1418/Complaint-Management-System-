import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { useDatabase, makeUser, models } from './helpers.js';
import { nextComplaintNumber, nextCapaNumber } from '../src/services/sequenceService.js';

useDatabase();

const { Complaint, ComplaintAssignment, WhatsappMessage, Notification, FishboneCause } = models;

function complaintInput(number) {
  return {
    complaintNumber: number,
    origin: 'WhatsApp',
    requester: { name: 'Test Retailer', email: 'r@example.test', mobile: '919800000000', type: 'Retailer' },
    sbu: 'AHP-Rumicare',
    country: 'India',
    shortDescription: 'Bottle seal broken on delivery',
  };
}

describe('complaint numbers', () => {
  it('are sequential within a year and use the placeholder format', async () => {
    const d = new Date('2026-05-01T10:00:00+05:30');
    expect(await nextComplaintNumber(d)).toBe('CMP-2026-000001');
    expect(await nextComplaintNumber(d)).toBe('CMP-2026-000002');
    expect(await nextComplaintNumber(new Date('2027-01-01T00:30:00+05:30'))).toBe('CMP-2027-000001');
  });

  it('uses the Indian calendar year at the boundary', async () => {
    // 31 Dec 2026 20:00 UTC is already 1 Jan 2027 in IST.
    expect(await nextComplaintNumber(new Date('2026-12-31T20:00:00Z'))).toBe('CMP-2027-000001');
  });

  it('stay unique under concurrent requests', async () => {
    const numbers = await Promise.all(Array.from({ length: 50 }, () => nextComplaintNumber(new Date('2026-06-01'))));
    expect(new Set(numbers).size).toBe(50);
  });

  it('are unique and immutable on the complaint', async () => {
    const c = await Complaint.create(complaintInput('CMP-2026-000010'));
    await expect(Complaint.create(complaintInput('CMP-2026-000010'))).rejects.toMatchObject({ code: 11000 });
    c.complaintNumber = 'CMP-2026-999999';
    await c.save();
    expect((await Complaint.findById(c._id)).complaintNumber).toBe('CMP-2026-000010');
  });

  it('CAPA numbers are scoped to their complaint', async () => {
    expect(await nextCapaNumber('CMP-2026-000001')).toBe('CMP-2026-000001-CAPA-01');
    expect(await nextCapaNumber('CMP-2026-000001')).toBe('CMP-2026-000001-CAPA-02');
    expect(await nextCapaNumber('CMP-2026-000002')).toBe('CMP-2026-000002-CAPA-01');
  });
});

describe('complaint defaults and validation', () => {
  it('starts at D1 / Submitted', async () => {
    const c = await Complaint.create(complaintInput('CMP-2026-000001'));
    expect(c.stage).toBe('D1');
    expect(c.status).toBe('SUBMITTED');
  });

  it('rejects unknown statuses and missing required fields', async () => {
    await expect(Complaint.create({ ...complaintInput('CMP-2026-000002'), status: 'MADE_UP' })).rejects.toThrow(/status/);
    await expect(Complaint.create({ complaintNumber: 'CMP-2026-000003', origin: 'WhatsApp' })).rejects.toThrow(/shortDescription|sbu/);
  });

  it('detects conflicting concurrent edits', async () => {
    const c = await Complaint.create(complaintInput('CMP-2026-000004'));
    const a = await Complaint.findById(c._id);
    const b = await Complaint.findById(c._id);
    a.headQuarter = 'Bengaluru';
    await a.save();
    b.headQuarter = 'Lucknow';
    await expect(b.save()).rejects.toBeInstanceOf(mongoose.Error.VersionError);
  });
});

describe('duplicate protection built into the schema', () => {
  it('allows only one active FRP assignment per complaint, keeping history', async () => {
    const c = await Complaint.create(complaintInput('CMP-2026-000001'));
    const qc = await makeUser({ roles: ['quality_coordinator'] });
    const frp1 = await makeUser({ roles: ['frp'] });
    const frp2 = await makeUser({ roles: ['frp'] });

    const first = await ComplaintAssignment.create({ complaint: c._id, role: 'FRP', assignee: frp1._id, assignedBy: qc._id });
    await expect(
      ComplaintAssignment.create({ complaint: c._id, role: 'FRP', assignee: frp2._id, assignedBy: qc._id }),
    ).rejects.toMatchObject({ code: 11000 });

    await ComplaintAssignment.updateOne({ _id: first._id }, { active: false, endedAt: new Date() });
    await ComplaintAssignment.create({ complaint: c._id, role: 'FRP', assignee: frp2._id, assignedBy: qc._id });
    expect(await ComplaintAssignment.countDocuments({ complaint: c._id })).toBe(2);
  });

  it('stores a WhatsApp message id only once', async () => {
    const msg = { waMessageId: 'wamid.ABC', direction: 'inbound', waId: '919800000000', type: 'text' };
    await WhatsappMessage.create(msg);
    await expect(WhatsappMessage.create(msg)).rejects.toMatchObject({ code: 11000 });
  });

  it('queues a notification for a business event only once', async () => {
    const n = { type: 'D1_ACKNOWLEDGEMENT', channel: 'email', recipient: 'r@example.test', dedupeKey: 'D1_ACK:abc' };
    await Notification.create(n);
    await expect(Notification.create(n)).rejects.toMatchObject({ code: 11000 });
  });

  it('accepts only the six fishbone categories', async () => {
    const id = new mongoose.Types.ObjectId();
    await expect(FishboneCause.create({ complaint: id, analysis: id, category: 'Money', text: 'x' })).rejects.toThrow(/category/);
    await expect(FishboneCause.create({ complaint: id, analysis: id, category: 'Machine', text: 'Worn seal head' })).resolves.toBeTruthy();
  });
});
