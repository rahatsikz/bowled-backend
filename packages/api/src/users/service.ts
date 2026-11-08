import { upsertUserByKey, upsertDevice } from '../db.js';

/** Service layer for user-related operations. */
export async function createUser(apiKey: string): Promise<{ id: string }> {
  return await upsertUserByKey(apiKey);
}

export async function registerDevice(userId: string, pushToken: string): Promise<string> {
  return await upsertDevice(userId, pushToken);
}

/** Build a minimal user deps object for controllers. */
export function makeUsersDeps() {
  return { upsertUserByKey, upsertDevice };
}