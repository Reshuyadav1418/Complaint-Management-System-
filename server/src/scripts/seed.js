/**
 * Idempotent setup script.
 *
 *   npm run seed                 roles + first administrator
 *   npm run seed -- --demo       also departments and one user per role
 *
 * The administrator comes from SEED_ADMIN_NAME / SEED_ADMIN_EMAIL /
 * SEED_ADMIN_PASSWORD. Nothing is overwritten if it already exists.
 * Demo data is for local development only and refuses to run in production.
 */
import env from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { ensureDefaultRoles } from '../services/roleService.js';
import { User, Department, LookupValue } from '../models/index.js';
import { password as passwordRule } from '../validation/common.js';

const DEMO_DEPARTMENTS = [
  { name: 'Quality Assurance', code: 'QA' },
  { name: 'Production', code: 'PROD' },
  { name: 'Customer Relationship Management', code: 'CRM' },
];

// Placeholder dropdown values, clearly marked, until the company's lists are
// loaded (OPEN_QUESTIONS Q6). Edit them in Settings → Lists.
const DEMO_LOOKUPS = [
  { list: 'manufacturingLocation', value: 'Plant 1 (demo)' },
  { list: 'manufacturingLocation', value: 'Plant 2 (demo)' },
  { list: 'locationDetail', parent: 'Plant 1 (demo)', value: 'Granulation line (demo)' },
  { list: 'locationDetail', parent: 'Plant 1 (demo)', value: 'Packing line (demo)' },
  { list: 'locationDetail', parent: 'Plant 2 (demo)', value: 'Filling line (demo)' },
  { list: 'typeOfFailure', value: 'Packaging defect (demo)' },
  { list: 'typeOfFailure', value: 'Physical appearance (demo)' },
  { list: 'typeOfFailure', value: 'Efficacy (demo)' },
  { list: 'typeOfFailure', value: 'Labelling (demo)' },
];

const DEMO_USERS = [
  { name: 'Demo Quality Coordinator', email: 'qc@example.test', roles: ['quality_coordinator'], dept: 'QA' },
  { name: 'Demo FRP', email: 'frp@example.test', roles: ['frp'], dept: 'PROD' },
  { name: 'Demo Reviewer', email: 'reviewer@example.test', roles: ['reviewer'], dept: 'QA' },
  { name: 'Demo Employee', email: 'employee@example.test', roles: ['employee'], dept: 'CRM' },
];

async function ensureUser({ name, email, roles, department, password, mustChangePassword }) {
  const existing = await User.findOne({ email });
  if (existing) {
    console.log(`  exists   ${email}`);
    return existing;
  }
  const user = new User({ name, email, roles, department, mustChangePassword });
  await user.setPassword(password);
  await user.save();
  console.log(`  created  ${email} (${roles.join(', ')})`);
  return user;
}

async function main() {
  const demo = process.argv.includes('--demo');
  if (demo && env.isProduction) throw new Error('Refusing to create demo data in production.');

  await connectDatabase();
  console.log('Roles');
  await ensureDefaultRoles();
  console.log('  default roles present');

  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD to create the first administrator.');
  }
  const check = passwordRule.safeParse(adminPassword);
  if (!check.success) throw new Error(`SEED_ADMIN_PASSWORD: ${check.error.issues[0].message}`);

  console.log('Administrator');
  await ensureUser({
    name: process.env.SEED_ADMIN_NAME || 'System Administrator',
    email: adminEmail.toLowerCase(),
    roles: ['admin'],
    password: adminPassword,
    // In production the first admin must replace the seeded password.
    mustChangePassword: env.isProduction,
  });

  if (demo) {
    console.log('Demo departments');
    const depts = {};
    for (const d of DEMO_DEPARTMENTS) {
      depts[d.code] = await Department.findOneAndUpdate({ code: d.code }, { $setOnInsert: d }, { upsert: true, returnDocument: 'after' });
      console.log(`  ${d.code}`);
    }
    console.log('Demo dropdown values');
    for (const l of DEMO_LOOKUPS) {
      await LookupValue.updateOne({ list: l.list, parent: l.parent, value: l.value }, { $setOnInsert: l }, { upsert: true });
    }
    console.log(`  ${DEMO_LOOKUPS.length} values`);
    console.log('Demo users (password: same as SEED_ADMIN_PASSWORD)');
    for (const u of DEMO_USERS) {
      await ensureUser({ ...u, department: depts[u.dept]._id, password: adminPassword, mustChangePassword: false });
    }
  }
}

main()
  .then(() => console.log('Seed complete.'))
  .catch((err) => {
    console.error(`Seed failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
