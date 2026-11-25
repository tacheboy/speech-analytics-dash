/**
 * Applies database migrations under an advisory lock, so several containers starting together
 * don't race. Run on every start (docker entrypoint) and by ./dev.sh: a no-op when up to date.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    await sql`select pg_advisory_lock(724001)`;
    await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
    await sql`select pg_advisory_unlock(724001)`;
    console.log("✓ database schema up to date");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("✗ migration failed:", e.message);
  process.exit(1);
});
