import { describe, expect, it, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    execute: vi.fn(),
  },
}));

vi.mock("@workspace/db", () => ({
  db: mockDb,
}));

import syncRouter from "./sync";

const TODAY = new Date("2026-09-02T12:00:00.000Z");
const YESTERDAY = new Date("2026-09-01T12:00:00.000Z");
const TOO_OLD = new Date("2026-08-31T12:00:00.000Z");

type SyncFixture = {
  id: number;
  entity_set_name: string;
  record_id: string;
  operation: string;
  error_message: string | null;
  created_on: Date;
};

const SYNC_FIXTURES: SyncFixture[] = [
  {
    id: 1,
    entity_set_name: "Account",
    record_id: "account-1",
    operation: "upsert",
    error_message: "Validation failed",
    created_on: TODAY,
  },
  {
    id: 2,
    entity_set_name: "Account",
    record_id: "account-2",
    operation: "upsert",
    error_message: "Timeout",
    created_on: YESTERDAY,
  },
  {
    id: 3,
    entity_set_name: "OPPORTUNITY",
    record_id: "opportunity-1",
    operation: "upsert",
    error_message: "Validation failed",
    created_on: TODAY,
  },
  {
    id: 4,
    entity_set_name: "QuOtE",
    record_id: "quote-1",
    operation: "upsert",
    error_message: "Validation failed",
    created_on: TODAY,
  },
  {
    id: 5,
    entity_set_name: "QuoteDetails",
    record_id: "quote-detail-1",
    operation: "upsert",
    error_message: "Validation failed",
    created_on: TODAY,
  },
  {
    id: 6,
    entity_set_name: "SALESORDERSSALESORDERDETAILS",
    record_id: "sales-order-detail-1",
    operation: "upsert",
    error_message: "Validation failed",
    created_on: TODAY,
  },
  {
    id: 7,
    entity_set_name: "Customer",
    record_id: "customer-1",
    operation: "upsert",
    error_message: "CONNECTION ERROR: gateway unavailable",
    created_on: TODAY,
  },
  {
    id: 8,
    entity_set_name: "Contact",
    record_id: "contact-1",
    operation: "upsert",
    error_message: "Validation failed",
    created_on: TOO_OLD,
  },
];

function queryText(query: unknown): string {
  return new PgDialect().sqlToQuery(query as SQL).sql;
}

function hasSyncFilters(sql: string): boolean {
  return (
    sql.includes("lower(entity_set_name) NOT IN") &&
    sql.includes("error_message IS NULL OR error_message NOT ILIKE") &&
    sql.includes("created_on >= CURRENT_DATE - INTERVAL '1 day'")
  );
}

function visibleFixtures(sql: string): SyncFixture[] {
  if (!hasSyncFilters(sql)) return SYNC_FIXTURES;

  return SYNC_FIXTURES.filter((row) => {
    const excludedEntity = new Set([
      "opportunity",
      "quote",
      "quotedetails",
      "salesorderssalesorderdetails",
    ]).has(row.entity_set_name.toLowerCase());
    const isConnectionError = row.error_message?.toLowerCase().includes("connection error");
    const isCurrent = row.created_on === TODAY || row.created_on === YESTERDAY;
    return !excludedEntity && !isConnectionError && isCurrent;
  });
}

function buildApp(): Express {
  const app = express();
  app.use("/api", syncRouter);
  return app;
}

const app = buildApp();

beforeEach(() => {
  mockDb.execute.mockImplementation(async (query: unknown) => {
    const sql = queryText(query);
    const rows = visibleFixtures(sql);

    if (sql.includes("SELECT COUNT(*)")) {
      const uniqueRecords = new Set(rows.map((row) => `${row.entity_set_name}:${row.record_id}`));
      return { rows: [{ n: uniqueRecords.size }] };
    }

    if (sql.includes("SELECT * FROM")) {
      return { rows };
    }

    const entities = new Map<string, Set<string>>();
    for (const row of rows) {
      const records = entities.get(row.entity_set_name) ?? new Set<string>();
      records.add(row.record_id);
      entities.set(row.entity_set_name, records);
    }
    return {
      rows: [...entities.entries()].map(([entity_set_name, records]) => ({
        entity_set_name,
        n: records.size,
      })),
    };
  });
});

describe("sync error-log filtering", () => {
  it("excludes all configured entities and connection errors from rows and unique counts", async () => {
    const response = await request(app).get("/api/sync/error-log");

    expect(response.status).toBe(200);
    expect(response.body.entries.map((entry: { id: number }) => entry.id)).toEqual([1, 2]);
    expect(response.body.totalUnique).toBe(2);

    const executedSql = mockDb.execute.mock.calls.map(([query]) => queryText(query));
    expect(executedSql).toHaveLength(2);
    expect(executedSql.every(hasSyncFilters)).toBe(true);
    expect(executedSql.every((sql) => sql.includes("ILIKE"))).toBe(true);
  });

  it("excludes the same records from entity counts while retaining today and yesterday", async () => {
    const response = await request(app).get("/api/sync/entities");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ entitySetName: "Account", uniqueErrors: 2 }]);

    const [executedSql] = mockDb.execute.mock.calls.map(([query]) => queryText(query));
    expect(executedSql).toContain("lower(entity_set_name) NOT IN");
    expect(executedSql).toContain("error_message IS NULL OR error_message NOT ILIKE");
    expect(executedSql).toContain("created_on >= CURRENT_DATE - INTERVAL '1 day'");
  });
});