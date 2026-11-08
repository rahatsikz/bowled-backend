import { Queue } from "bullmq";

export function createQueue(redisUrl: string): Queue {
  return new Queue("deliveries", { connection: { redisUrl } });
}