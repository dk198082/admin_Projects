import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express, type Request } from "express";
import request from "supertest";

const { mockDb } = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const insertQueue: unknown[][] = [];
  const insertedValues: unknown[] = [];

  function makeSelectChain(result: unknown[]) {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.then = (onFulfilled: (value: unknown[]) => unknown) =>
      Promise.resolve(result).then(onFulfilled);
    return chain;
  }

  function makeInsertChain(result: unknown[]) {
    const chain: Record<string, unknown> = {};
    chain.values = (values: unknown) => {
      insertedValues.push(values);
      return chain;
    };
    chain.onConflictDoNothing = () => chain;
    chain.returning = () => Promise.resolve(result);
    chain.then = (onFulfilled: (value: unknown[]) => unknown) =>
      Promise.resolve(result).then(onFulfilled);
    return chain;
  }

  const db = {
    _selectQueue: selectQueue,
    _insertQueue: insertQueue,
    _insertedValues: insertedValues,
    select: vi.fn(() => makeSelectChain(selectQueue.shift() ?? [])),
    insert: vi.fn(() => makeInsertChain(insertQueue.shift() ?? [])),
    transaction: vi.fn(),
  };
  db.transaction.mockImplementation(
    async (callback: (tx: typeof db) => Promise<unknown>) => callback(db),
  );

  return { mockDb: db };
});

vi.mock("@workspace/db", () => ({
  db: mockDb,
  appsTable: {},
  resourcesTable: {},
  securityPoliciesTable: {},
  apiKeysTable: {},
  rolesTable: {},
  accessGrantsTable: {},
}));

vi.mock("../lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

import appsResourcesRouter from "./appsResources";

const APP = { id: 42, name: "Customer Portal" };
const ENTITLEMENT_ROLES = [
  {
    id: 101,
    name: "Customer Portal - Read Only",
    description: "Auto-managed entitlement: Read Only access to all Customer Portal resources",
    appId: APP.id,
    isEntitlement: true,
  },
  {
    id: 102,
    name: "Customer Portal - Read / Write",
    description: "Auto-managed entitlement: Read / Write access to all Customer Portal resources",
    appId: APP.id,
    isEntitlement: true,
  },
];

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res, next) => {
    req.session = {
      user: {
        id: 1,
        entraObjectId: "test-user",
        email: "admin@example.com",
        name: "Test Admin",
      },
    } as Request["session"];
    next();
  });
  app.use("/api", appsResourcesRouter);
  return app;
}

const app = buildApp();

beforeEach(() => {
  mockDb._selectQueue.length = 0;
  mockDb._insertQueue.length = 0;
  mockDb._insertedValues.length = 0;
  mockDb.select.mockClear();
  mockDb.insert.mockClear();
  mockDb.transaction.mockClear();
});

describe("app creation entitlement roles", () => {
  it("creates both Read Only and Read / Write roles for a new app", async () => {
    // First select checks for a case-insensitive duplicate. The next five
    // selects are the resource and role checks made by ensureEntitlementsForApp.
    mockDb._selectQueue.push([], [], [], [], [], []);
    mockDb._insertQueue.push(
      [APP],
      [],
      [ENTITLEMENT_ROLES[0]],
      [ENTITLEMENT_ROLES[1]],
    );

    const response = await request(app).post("/api/apps").send({ name: " Customer Portal " });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ ...APP, resourceCount: 0 });

    const roleInserts = mockDb._insertedValues.filter(
      (values): values is { name: string; appId: number; isEntitlement: boolean } =>
        typeof values === "object" &&
        values !== null &&
        "name" in values &&
        typeof values.name === "string" &&
        "isEntitlement" in values &&
        values.isEntitlement === true,
    );
    expect(roleInserts.map((role) => role.name)).toEqual([
      "Customer Portal - Read Only",
      "Customer Portal - Read / Write",
    ]);
    expect(roleInserts.every((role) => role.appId === APP.id && role.isEntitlement)).toBe(true);
  });
});