import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL ?? "postgresql://cronoblox:cronoblox@localhost:5434/cronoblox";
const globalDb = globalThis as unknown as { cronobloxSql?: ReturnType<typeof postgres> };
export const sql = globalDb.cronobloxSql ?? postgres(connectionString, { max: 10 });
if (process.env.NODE_ENV !== "production") globalDb.cronobloxSql = sql;
export const db = drizzle(sql, { schema });
export * from "./schema";
export * from "./repository";
