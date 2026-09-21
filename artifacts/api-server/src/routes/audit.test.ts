import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { mockDb } = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];

  function makeSelectChain(result: unknown[]) {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.groupBy = () => chain;
    chain.having = () => chain;
    chain.orderBy = () => chain;
    chain.limit = () => chain;
    chain.then = (onFulfilled: (value: unknown[]) => unknown) =>
      Promise.resolve(result).then(onFulfilled);
    return chain;
  }

  return {
    mockDb: {
      _selectQueue: selectQueue,
      select: vi.fn(() => makeSelectChain(selectQueue.shift() ?? [])),
    },
  };
});

vi.mock("@workspace/db", () => ({
  db: mockDb,
  auditLogTable: {},
  usersTable: {},
  rolesTable: {},
  appsTable: {},
  resourcesTable: {},
  accessGrantsTable: {},
  roleAssignmentsTable: {},
}));

import auditRouter from "./audit";

const app = express();
app.use(express.json());
app.use("/api", auditRouter);

beforeEach(() => {
  mockDb._selectQueue.length = 0;
  mockDb.select.mockClear();
});

describe("GET /api/activity-report", () => {
  it("aggregates only allowed access by person and application", async () => {
    mockDb._selectQueue.push(
      [
        {
          id: 1,
          action: "login",
          entity: "Session",
          detail: "Alex signed in via Entra ID",
          actor: "Alex",
          createdAt: new Date("2026-09-15T08:00:00.000Z"),
        },
        {
          id: 2,
          action: "ACCESS_ALLOWED",
          entity: "entra-alex",
          detail: "key=ak_123 app=Packing Control Board",
          actor: "API Key: ak_123",
          createdAt: new Date("2026-09-15T08:05:00.000Z"),
        },
        {
          id: 3,
          action: "ACCESS_DENIED",
          entity: "entra-alex",
          detail: "key=ak_123 app=Packing Control Board reason=User is disabled",
          actor: "API Key: ak_123",
          createdAt: new Date("2026-09-15T08:06:00.000Z"),
        },
        {
          id: 4,
          action: "update",
          entity: "Security Policy",
          detail: "Updated security policy",
          actor: "Alex",
          createdAt: new Date("2026-09-16T09:00:00.000Z"),
        },
        {
          id: 5,
          action: "login",
          entity: "Session",
          detail: "Jordan signed in via Entra ID",
          actor: "Jordan",
          createdAt: new Date("2026-09-16T10:00:00.000Z"),
        },
      ],
      [
        { entraObjectId: "entra-alex", name: "Alex" },
        { entraObjectId: "entra-jordan", name: "Jordan" },
      ],
      [{ name: "Packing Control Board" }],
    );

    const response = await request(app)
      .get("/api/activity-report")
      .query({
        from: "2026-09-01",
        to: "2026-09-30",
        person: ["Alex", "Casey"],
      });

    expect(response.status).toBe(200);
    expect(response.body.summary).toEqual({
      allowedAccess: 1,
      activePeople: 1,
      activeApps: 1,
    });
    expect(response.body.byPersonApp).toEqual([
      {
        person: "Alex",
        app: "Packing Control Board",
        allowedAccess: 1,
      },
    ]);
  });

  it("rejects an inverted date range", async () => {
    const response = await request(app)
      .get("/api/activity-report")
      .query({ from: "2026-09-30", to: "2026-09-01" });

    expect(response.status).toBe(400);
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});