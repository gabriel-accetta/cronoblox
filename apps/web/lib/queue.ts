import { Queue } from "bullmq";
import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6381";
const globalQueue = globalThis as unknown as { cronobloxRedis?: IORedis; cronobloxQueue?: Queue };

function getQueue() {
  if (globalQueue.cronobloxQueue) return globalQueue.cronobloxQueue;
  const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue("cronoblox-analysis", { connection: redis });
  if (process.env.NODE_ENV !== "production") { globalQueue.cronobloxRedis = redis; globalQueue.cronobloxQueue = queue; }
  return queue;
}

export async function enqueueRun(runId: string) {
  await getQueue().add("analyze", { runId }, { jobId: runId, attempts: 3, backoff: { type: "exponential", delay: 1000 }, removeOnComplete: 100, removeOnFail: 100 });
}
