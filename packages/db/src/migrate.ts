import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sql } from "./index";

await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname.replace(/^\/(.:)/, "$1") });
await sql.end();
console.log("Database migrations applied.");
