import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { getDbPoolConfig } from "./poolConfig";

const { Pool } = pg;

export const pool = new Pool(getDbPoolConfig());
export const db = drizzle(pool, { schema });

export { getDbPoolConfig } from "./poolConfig";
export * from "./schema";
