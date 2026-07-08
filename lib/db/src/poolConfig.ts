import type pg from "pg";

const AZURE_SCHEMA = process.env.AZURE_PG_SCHEMA ?? "admin_console";

function parseLenientPostgresUrl(raw: string): pg.PoolConfig {
  // Passwords in user-provided connection strings often contain characters
  // that are not percent-encoded, which URL parsers reject. Parse manually:
  // postgresql://user:password@host[:port]/dbname[?params]
  const m = raw
    .trim()
    .match(/^postgres(?:ql)?:\/\/(.+)@([^@/]+)\/([^?]+)(?:\?.*)?$/);
  if (!m) {
    throw new Error("AZURE_DATABASE_URL is not a valid postgres:// URL");
  }
  const [, userinfo, hostport, database] = m;
  const colon = userinfo.indexOf(":");
  if (colon === -1) {
    throw new Error("AZURE_DATABASE_URL must include a password");
  }
  const user = decodeURIComponent(userinfo.slice(0, colon));
  const password = userinfo.slice(colon + 1);
  const [host, port] = hostport.split(":");
  return {
    host,
    port: port ? Number(port) : 5432,
    database,
    user,
    password,
    // Azure PostgreSQL certificates chain to public CAs, so full
    // certificate verification works (stronger than sslmode=require).
    ssl: { rejectUnauthorized: true },
    options: `-csearch_path=${AZURE_SCHEMA}`,
  };
}

/**
 * Returns a percent-encoded connection URL for tooling (drizzle-kit) that
 * targets the same database and schema as the runtime pool.
 */
export function getDbUrlForTooling(): string {
  const cfg = getDbPoolConfig();
  if ("connectionString" in cfg && cfg.connectionString) {
    return cfg.connectionString;
  }
  const user = encodeURIComponent(String(cfg.user));
  const pass = encodeURIComponent(String(cfg.password));
  const search = `options=${encodeURIComponent(`-csearch_path=${AZURE_SCHEMA}`)}&sslmode=require`;
  return `postgresql://${user}:${pass}@${cfg.host}:${cfg.port}/${cfg.database}?${search}`;
}

/**
 * Returns the pg pool config for the application database.
 * Prefers AZURE_DATABASE_URL (Azure PostgreSQL, admin_console schema);
 * falls back to the Replit-managed DATABASE_URL.
 */
export function getDbPoolConfig(): pg.PoolConfig {
  const azureUrl = process.env.AZURE_DATABASE_URL;
  if (azureUrl && azureUrl.trim() !== "") {
    return parseLenientPostgresUrl(azureUrl);
  }
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "Neither AZURE_DATABASE_URL nor DATABASE_URL is set. Did you forget to provision a database?",
    );
  }
  return { connectionString: process.env.DATABASE_URL };
}
