import { Queue } from "bullmq";
import { Redis } from "ioredis";

export function createQueue(redisUrl: string): Queue {
  // BullMQ v6 takes an already-constructed Redis client (it no longer bundles
  // one); maxRetriesPerRequest: null keeps BullMQ's blocking commands happy.
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  return new Queue("deliveries", { connection });
}
