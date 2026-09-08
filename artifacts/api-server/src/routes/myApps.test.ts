/**
 * Unit tests for GET /api/my-apps — the Workspace Shell's app launcher feed.
 *
 * @workspace/db is fully mocked so no real database is required; each test
 * queues exactly what each Drizzle select chain should return. The
 * entitlement filtering itself (does the user actually get this app back)
 * was additionally verified against a real Postgres database with seeded
 * data as part of building this feature — see docs/workspace/TECHNICAL_DESIGN.md
 * for that end-to-end check. These tests cover the route's own logic:
 * session handling, the two-table bridge (session -> directory user via
 * entraObjectId), and the "no directory row yet" edge case.
 */
import { describe, it, expect, vi } from "vitest";
import express, { type Express, type Request } from "express";
import request from "supertest";

const { mockDb } = vi.hoisted(() => {
  const _selectQueue: unknown[][] = [];

  function makeChain(result: unknown[]) {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.innerJoin = () => chain;
    chain.orderBy = () => chain;
    chain.then = (onFulfilled: (v: unknown[]) => unknown) =>
      Promise.resolve(result).then(onFulfilled);
    return chain;
  }

  const mockDb = {
    _selectQueue,
    select: vi.fn(() => makeChain(_selectQueue.shift() ?? [])),
    selectDistinct: vi.fn(() => makeChain(_selectQueue.shift() ?? [])),
  };

  return { mockDb };
});

vi.mock("@workspace/db", () => ({
  db: mockDb,
  usersTable: {},
  roleAssignmentsTable: {},
  rolesTable: {},
  appsTable: {},
}));

import myAppsRouter from "./myApps";

function buildApp(sessionUser?: { entraObjectId: string; name: string }): Express {
  const app = express();
  app.use((req: Request, _res, next) => {
    (req as unknown as { session: { user?: typeof sessionUser } }).session = {
      user: sessionUser,
    };
    next();
  });
  app.use("/api", myAppsRouter);
  return app;
}

function queueSelect(...results: unknown[][]): void {
  for (const r of results) mockDb._selectQueue.push(r);
}

describe("GET /api/my-apps", () => {
  it("returns 401 when there is no session", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/my-apps");
    expect(res.status).toBe(401);
  });

  it("returns an empty app list (not an error) when the signed-in user has no directory row yet", async () => {
    const app = buildApp({ entraObjectId: "oid-1", name: "New User" });
    queueSelect([]); // directoryUser lookup finds nothing
    const res = await request(app).get("/api/my-apps");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userName: "New User", apps: [] });
  });

  it("returns an empty app list when the directory user exists but is not active", async () => {
    const app = buildApp({ entraObjectId: "oid-2", name: "Disabled User" });
    queueSelect([{ id: 7, name: "Disabled User", status: "disabled" }]);
    const res = await request(app).get("/api/my-apps");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userName: "Disabled User", apps: [] });
  });

  it("returns the entitled apps for an active user, using the directory's name (not the session's)", async () => {
    const app = buildApp({ entraObjectId: "oid-3", name: "Session Name" });
    queueSelect(
      [{ id: 5, name: "Directory Name", status: "active" }],
      [
        {
          id: 1,
          name: "Field Service Calendar",
          description: "Technicians & schedules",
          icon: "Wrench",
          category: "Field Operations",
          launchUrl: "https://fieldservice.contoso.com",
        },
      ],
    );
    const res = await request(app).get("/api/my-apps");
    expect(res.status).toBe(200);
    expect(res.body.userName).toBe("Directory Name");
    expect(res.body.apps).toEqual([
      {
        id: 1,
        name: "Field Service Calendar",
        description: "Technicians & schedules",
        icon: "Wrench",
        category: "Field Operations",
        launchUrl: "https://fieldservice.contoso.com",
      },
    ]);
  });
});
