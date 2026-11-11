import type { ApiDb } from '../db.js';

/** Service layer for user-related operations. */
export async function createUser(db: ApiDb, apiKey: string): Promise<{ id: string }> {
  return await db.upsertUserByKey(apiKey);
}

export async function registerDevice(db: ApiDb, userId: string, pushToken: string): Promise<string> {
  return await db.upsertDevice(userId, pushToken);
}
