import { ensureSchema, upsertUserByKey, upsertDevice, makeApiDb } from '../db.js';

/** Users-specific wrapper that ensures schema runs on first access. */
export { ensureSchema };

export async function createUser(apiKey: string): Promise<{ id: string }> {
  await ensureSchema();
  return await upsertUserByKey(apiKey);
}

export async function registerDevice(userId: string, pushToken: string): Promise<string> {
  await ensureSchema();
  return await upsertDevice(userId, pushToken);
}