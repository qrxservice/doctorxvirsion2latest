import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// DATABASE_URL is runtime-managed by Replit and is automatically injected for
// both development and production environments. We intentionally do NOT throw
// at module-load time here; an early throw would crash the process before
// server.listen() is called, which silently fails the health probe. If the
// variable is genuinely missing the pool will throw on the first real query,
// which produces a clear 500 error in the response logs instead of a silent
// startup crash with no visible output.
if (!process.env.DATABASE_URL) {
  console.error(
    "[db] WARNING: DATABASE_URL is not set. All database operations will fail at query time. " +
      "Replit should inject this automatically — check that the PostgreSQL database is provisioned.",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://localhost/unreachable",
});
export const db = drizzle(pool, { schema });

export * from "./schema";
