/**
 * Uses TEST_MONGODB_URI if set (e.g. a local replica set or CI service).
 * Otherwise starts a throwaway in-memory replica set; the first run downloads
 * a MongoDB binary, so it needs internet access once.
 */
export default async function setup({ provide }) {
  if (process.env.TEST_MONGODB_URI) {
    provide('mongoUri', process.env.TEST_MONGODB_URI);
    return undefined;
  }
  const { MongoMemoryReplSet } = await import('mongodb-memory-server-core');
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  provide('mongoUri', rs.getUri('sfa_cms_test'));
  return async () => rs.stop();
}
