import { profiles } from "@cronoblox/config";
import { db, sql } from "./index";
import { analysisProfiles } from "./schema";

for (const snapshot of Object.values(profiles)) {
  await db.insert(analysisProfiles).values({ id: snapshot.id, version: snapshot.version, snapshot }).onConflictDoNothing();
}
await sql.end();
console.log(`Seeded ${Object.keys(profiles).length} analysis profiles.`);
