import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export function getDb(env?: { HYPERDRIVE?: { connectionString: string } }) {
  const connectionString =
    env?.HYPERDRIVE?.connectionString ?? process.env.DATABASE_URL!;
  const pool = new Pool({
    connectionString,
    max: 1,
  });
  return drizzle(pool);
}
