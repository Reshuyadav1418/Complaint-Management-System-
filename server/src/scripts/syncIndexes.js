/** Create or update all collection indexes. Run once per release in production. */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import '../models/index.js';

try {
  await connectDatabase();
  for (const model of Object.values(mongoose.models)) {
    await model.syncIndexes();
    console.log(`  indexes ok  ${model.collection.collectionName}`);
  }
} catch (err) {
  console.error(`Index sync failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
