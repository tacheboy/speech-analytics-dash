import { execSync } from "node:child_process";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

export const TEST_DB = "postgres://insights:insights@localhost:5433/insights_test";

/** Fresh, seeded test database per run so API tests never touch demo data. */
export default async function setup() {
  const admin = postgres("postgres://insights:insights@localhost:5433/insights", { max: 1 });
  await admin.unsafe("DROP DATABASE IF EXISTS insights_test WITH (FORCE)");
  await admin.unsafe("CREATE DATABASE insights_test");
  await admin.end();
  const client = postgres(TEST_DB, { max: 1 });
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  await client.end();
  execSync("npx tsx scripts/seed.ts", { env: { ...process.env, DATABASE_URL: TEST_DB }, stdio: "ignore" });
}
