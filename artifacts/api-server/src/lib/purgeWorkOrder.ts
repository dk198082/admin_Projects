/**
 * Portable work-order purge module.
 *
 * Deletes every row associated with one or more D365 F&O production order
 * numbers from the Azure PostgreSQL BYOD staging mirror (schema `d365fo`).
 *
 * Why this exists: the BYOD incremental export only pushes inserts/updates.
 * When a production order is deleted in F&O, its rows stay in the staging
 * mirror forever and keep showing up in downstream apps. This module removes
 * them safely.
 *
 * Safety guarantees:
 *  - Every DELETE is filtered by the explicit order-number list AND
 *    dataareaid = <company> (default 'TOUS'). Rows for other companies with
 *    the same order numbers (e.g. TOUK) are never touched.
 *  - All deletes run inside a single transaction.
 *  - Dry-run mode (the default in the CLI) only counts matching rows.
 *
 * Dependencies: `pg` only. No project-specific imports — copy this folder
 * into any Node/TypeScript project.
 */

import type { ClientBase } from "pg";

/** Staging tables that reference a production order, with their key column. */
export const PURGE_TABLES: ReadonlyArray<{ table: string; keyColumn: string }> = [
  { table: "prodproductionorderheaderstaging", keyColumn: "productionordernumber" },
  { table: "prodproductionorderbillofmaterialslinestaging", keyColumn: "productionordernumber" },
  { table: "prodproductionorderrouteoperationstaging", keyColumn: "productionordernumber" },
  { table: "prodproductionorderrouteoperationresourcerequirementstaging", keyColumn: "productionordernumber" },
  { table: "prodproductionpickinglistjournalentrystaging", keyColumn: "productionordernumber" },
  { table: "prodroutecardproductionjournalentrystaging", keyColumn: "productionordernumber" },
  { table: "prodproductionroutetransactionstaging", keyColumn: "torefnumber" },
  { table: "wrkctroperationsresourcecapacityreservationstaging", keyColumn: "productionordernumber" },
];

/** PostgreSQL truncates identifiers to 63 chars — the `_load` twin of the
 *  resource-requirement table is actually `..._loa`. */
function loadTwin(table: string): string {
  return `${table}_load`.slice(0, 63);
}

export interface PurgeOptions {
  /** Only count matching rows; do not delete. */
  dryRun: boolean;
  /** Company (dataareaid) to restrict deletes to. Default: "TOUS". */
  dataAreaId?: string;
  /** Schema holding the staging tables. Default: "d365fo". */
  schema?: string;
}

export interface PurgeResult {
  dryRun: boolean;
  dataAreaId: string;
  orderNumbers: string[];
  /** Rows counted (dry run) or deleted (execute) per table. */
  counts: Record<string, number>;
  totalRows: number;
}

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

/**
 * Purge (or dry-run count) all staging rows for the given order numbers.
 *
 * @param client  A connected pg Client (or a client checked out from a Pool).
 *                The function manages its own transaction on this connection.
 */
export async function purgeWorkOrder(
  client: ClientBase,
  orderNumbers: string[],
  opts: PurgeOptions,
): Promise<PurgeResult> {
  const orders = [...new Set(orderNumbers.map((o) => o.trim()).filter(Boolean))];
  if (orders.length === 0) {
    throw new Error("No order numbers supplied");
  }
  const dataAreaId = opts.dataAreaId ?? "TOUS";
  const schema = opts.schema ?? "d365fo";
  if (!IDENT_RE.test(schema)) throw new Error(`Invalid schema name: ${schema}`);

  const targets = PURGE_TABLES.flatMap(({ table, keyColumn }) => [
    { table, keyColumn },
    { table: loadTwin(table), keyColumn },
  ]);

  const counts: Record<string, number> = {};
  let totalRows = 0;

  await client.query("BEGIN");
  try {
    for (const { table, keyColumn } of targets) {
      if (!IDENT_RE.test(table) || !IDENT_RE.test(keyColumn)) {
        throw new Error(`Invalid identifier: ${table}.${keyColumn}`);
      }
      const where = `WHERE ${keyColumn} = ANY($1) AND dataareaid = $2`;
      const sql = opts.dryRun
        ? `SELECT count(*)::int AS n FROM ${schema}.${table} ${where}`
        : `WITH del AS (DELETE FROM ${schema}.${table} ${where} RETURNING 1)
           SELECT count(*)::int AS n FROM del`;
      const res = await client.query(sql, [orders, dataAreaId]);
      const n = res.rows[0].n as number;
      counts[table] = n;
      totalRows += n;
    }
    await client.query(opts.dryRun ? "ROLLBACK" : "COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  }

  return { dryRun: opts.dryRun, dataAreaId, orderNumbers: orders, counts, totalRows };
}
