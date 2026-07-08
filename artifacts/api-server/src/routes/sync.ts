import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  ListSyncErrorsQueryParams,
  ListSyncErrorsResponse,
  ListSyncEntitiesResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/sync/error-log", async (req, res): Promise<void> => {
  const query = ListSyncErrorsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const limit = Math.max(1, Math.min(query.data.limit ?? 100, 500));
  const search = query.data.search?.trim();
  const entity = query.data.entity?.trim();
  const conditions = [];
  if (entity) {
    conditions.push(sql`entity_set_name = ${entity}`);
  }
  if (search) {
    conditions.push(
      sql`(entity_set_name ILIKE ${"%" + search + "%"} OR record_id::text ILIKE ${"%" + search + "%"} OR error_message ILIKE ${"%" + search + "%"})`,
    );
  }
  const searchFilter = conditions.length
    ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
    : sql``;

  const [rowsResult, countResult] = await Promise.all([
    db.execute(sql`
      SELECT * FROM (
        SELECT DISTINCT ON (entity_set_name, record_id)
          id,
          entity_set_name,
          record_id::text AS record_id,
          operation,
          error_message,
          created_on
        FROM sync.error_log
        ${searchFilter}
        ORDER BY entity_set_name, record_id, created_on DESC NULLS LAST, id DESC
      ) dedup
      ORDER BY created_on DESC NULLS LAST, id DESC
      LIMIT ${limit}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS n FROM (
        SELECT DISTINCT entity_set_name, record_id FROM sync.error_log ${searchFilter}
      ) u
    `),
  ]);

  const entries = rowsResult.rows.map((r) => {
    const row = r as {
      id: string | number;
      entity_set_name: string;
      record_id: string | null;
      operation: string | null;
      error_message: string | null;
      created_on: Date | string | null;
    };
    return {
      id: Number(row.id),
      entitySetName: row.entity_set_name,
      recordId: row.record_id,
      operation: row.operation ?? "",
      errorMessage: row.error_message ?? "",
      createdOn:
        row.created_on == null
          ? null
          : row.created_on instanceof Date
            ? row.created_on.toISOString()
            : String(row.created_on),
    };
  });

  res.json(
    ListSyncErrorsResponse.parse({
      entries,
      totalUnique: (countResult.rows[0] as { n: number }).n,
    }),
  );
});

router.get("/sync/entities", async (_req, res): Promise<void> => {
  const result = await db.execute(sql`
    SELECT entity_set_name, COUNT(DISTINCT record_id)::int + (COUNT(*) FILTER (WHERE record_id IS NULL) > 0)::int AS n
    FROM sync.error_log
    GROUP BY entity_set_name
    ORDER BY entity_set_name
  `);
  res.json(
    ListSyncEntitiesResponse.parse(
      result.rows.map((r) => {
        const row = r as { entity_set_name: string; n: number };
        return { entitySetName: row.entity_set_name, uniqueErrors: row.n };
      }),
    ),
  );
});

export default router;
