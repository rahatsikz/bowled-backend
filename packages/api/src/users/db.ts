import { upsertUserByKey, upsertDevice } from '../db.js';

export async function createUser(apiKey: string): Promise<{ id: string }> {
  return await upsertUserByKey(apiKey);
}

export async function registerDevice(userId: string, pushToken: string): Promise<string> {
  return await upsertDevice(userId, pushToken);
}
