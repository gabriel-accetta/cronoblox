import { Worker } from "bullmq";
import IORedis from "ioredis";
import { executeRun } from "@cronoblox/engine";

const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6381", { maxRetriesPerRequest: null });
const worker = new Worker<{ runId: string }>("cronoblox-analysis", async (job) => { await executeRun(job.data.runId); }, { connection: redis, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2), lockDuration: 300_000 });
worker.on("completed", (job) => console.log(`[worker] completed ${job.id}`));
worker.on("failed", (job, error) => console.error(`[worker] failed ${job?.id}: ${error.message}`));
console.log("Cronoblox worker ready.");

async function shutdown() { await worker.close(); await redis.quit(); process.exit(0); }
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
