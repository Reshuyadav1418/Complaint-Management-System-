import mongoose from 'mongoose';
import request from 'supertest';
import { beforeAll, afterAll, beforeEach } from 'vitest';
import * as models from '../src/models/index.js';
import { createApp } from '../src/app.js';
import { ensureDefaultRoles, clearRoleCache } from '../src/services/roleService.js';
import { clearReportCache } from '../src/services/reportService.js';

export const PASSWORD = 'Correct-horse-42';
export { models };

/** Connect once per file, wipe data before every test, keep indexes. */
export function useDatabase() {
  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    await mongoose.connection.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  });
  beforeEach(async () => {
    const collections = await mongoose.connection.db.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
    clearRoleCache();
    clearReportCache();
    await ensureDefaultRoles();
  });
  afterAll(async () => {
    await mongoose.disconnect();
  });
}

export const app = createApp();

export async function makeUser(overrides = {}) {
  const user = new models.User({
    name: overrides.name || 'Test User',
    email: overrides.email || `user${Math.random().toString(36).slice(2, 8)}@example.test`,
    roles: overrides.roles || ['employee'],
    mustChangePassword: overrides.mustChangePassword ?? false,
    isActive: overrides.isActive ?? true,
    department: overrides.department,
  });
  await user.setPassword(overrides.password || PASSWORD);
  await user.save();
  return user;
}

/** Returns a supertest agent that carries the session cookie. */
export async function signIn(user, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password });
  if (res.status !== 200) throw new Error(`signIn failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

/** A valid staff-entered complaint body; override any field. */
export function complaintBody(overrides = {}) {
  return {
    origin: 'Phone',
    requester: { name: 'Sunil Traders', email: 'sunil@example.test', mobile: '+91 98000 00000', type: 'Retailer' },
    sbu: 'AHP-Rumicare',
    country: 'India',
    headQuarter: 'Lucknow',
    shortDescription: 'Bottle seal broken on delivery',
    customer: { name: 'Sunil Traders' },
    reportedProduct: { name: 'Rumicare Bolus', batchNumber: 'RB2409' },
    ...overrides,
  };
}

/** Create a complaint through the service as a given user. */
export async function makeComplaint(actor, overrides = {}) {
  const { createComplaint } = await import('../src/services/complaintService.js');
  const { origin, ...input } = complaintBody(overrides);
  return createComplaint(input, { actor, origin });
}
