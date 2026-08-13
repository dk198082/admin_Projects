/**
 * Tests confirming the /api/api-keys routes require an authenticated session
 * and that the happy paths work correctly for authenticated callers.
 *
 * @workspace/db is fully mocked so no real database is required.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { type Express, type Request } from "express";
import request from "supertest";
import { requireAuth } from "../middlewares/requireAuth";

// ---------------------------------------------------------------------------
// Hoist mock objects so vi.mock factories can reference them.
// ---------------------------------------------------------------------------
const { mockDb } = vi.hoisted(() => {
  /** Generic chainable builder that resolves to a dequeued result. */
  function makeSelectChain(result: unknown[]) {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.orderBy = () => chain;
    chain.then = (onFulfilled: (v: unknown[]) => unknown) =>
      Promise.resolve(result).then(onFulfilled);
    return chain;
  }

  /** Chainable insert builder — resolves to a dequeued result via .returning(). */
  function makeInsertChain(result: unknown[]) {
    const chain: Record<string, unknown> = {};
    chain.values = () => chain;
    chain.returning = () => Promise.resolve(result);
    return chain;
  }

  /** Chainable update builder — resolves to a dequeued result via .returning(). */
  function makeUpdateChain(result: unknown[]) {
    const chain: Record<string, unknown> = {};
    chain.set = () => chain;
    chain.where = () => chain;
    chain.returning = () => Promise.resolve(result);
    return chain;
  }

  const _selectQueue: unknown[][] = [];
  const _insertQueue: unknown[][] = [];
  const _updateQueue: unknown[][] = [];

  const mockDb = {
    _selectQueue,
    _insertQueue,
    _updateQueue,
    select: vi.fn(() => makeSelectChain(_selectQueue.shift() ?? [])),
    insert: vi.fn(() => makeInsertChain(_insertQueue.shift() ?? [])),
    update: vi.fn(() => makeUpdateChain(_updateQueue.shift() ?? [])),
  };

  return { mockDb };
});

// ---------------------------------------------------------------------------
// Mock @workspace/db before the router is imported.
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => ({
  db: mockDb,
  apiKeysTable: {},
}));

// ---------------------------------------------------------------------------
// Mock the audit logger — side-effect only, not under test here.
// ---------------------------------------------------------------------------
vi.mock("../lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Import the router AFTER mocks are wired.
// ---------------------------------------------------------------------------
import apiKeysRouter from "./apiKeys";

// ---------------------------------------------------------------------------
// App builders
// ---------------------------------------------------------------------------

/** Unauthenticated app — no session user set; requireAuth will reject. */
function buildUnauthApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(requireAuth);
  app.use("/api", apiKeysRouter);
  return app;
}

/** Authenticated app — session.user is pre-populated before requireAuth. */
function buildAuthApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res, next) => {
    (req as unknown as { session: { user: { id: number; entraObjectId: string; email: string; name: string } } }).session = {
      user: { id: 1, entraObjectId: "test-oid", email: "test@example.com", name: "Test Admin" },
    };
    next();
  });
  app.use(requireAuth);
  app.use("/api", apiKeysRouter);
  return app;
}

const unauthApp = buildUnauthApp();
const authApp = buildAuthApp();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function queueSelect(...results: unknown[][]): void {
  for (const r of results) mockDb._selectQueue.push(r);
}

function queueInsert(...results: unknown[][]): void {
  for (const r of results) mockDb._insertQueue.push(r);
}

function queueUpdate(...results: unknown[][]): void {
  for (const r of results) mockDb._updateQueue.push(r);
}

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

const API_KEY_ROW = {
  id: 1,
  appName: "MyApp",
  label: "integration tests",
  keyHash: "deadbeef",
  keyPrefix: "ak_aabbccdd",
  createdAt: new Date("2025-06-01T00:00:00Z"),
  revokedAt: null,
  lastUsedAt: null,
};

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

function makeSelectChain(result: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.then = (onFulfilled: (v: unknown[]) => unknown) =>
    Promise.resolve(result).then(onFulfilled);
  return chain;
}

function makeInsertChain(result: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.values = () => chain;
  chain.returning = () => Promise.resolve(result);
  return chain;
}

function makeUpdateChain(result: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.set = () => chain;
  chain.where = () => chain;
  chain.returning = () => Promise.resolve(result);
  return chain;
}

beforeEach(() => {
  mockDb._selectQueue.length = 0;
  mockDb._insertQueue.length = 0;
  mockDb._updateQueue.length = 0;
  vi.clearAllMocks();

  mockDb.select.mockImplementation(() =>
    makeSelectChain(mockDb._selectQueue.shift() ?? []),
  );
  mockDb.insert.mockImplementation(() =>
    makeInsertChain(mockDb._insertQueue.shift() ?? []),
  );
  mockDb.update.mockImplementation(() =>
    makeUpdateChain(mockDb._updateQueue.shift() ?? []),
  );
});

afterEach(() => {
  mockDb._selectQueue.length = 0;
  mockDb._insertQueue.length = 0;
  mockDb._updateQueue.length = 0;
});

// ---------------------------------------------------------------------------
// Tests — unauthenticated callers must be rejected
// ---------------------------------------------------------------------------

describe("API key routes — unauthenticated access", () => {
  it("GET /api/api-keys without a session returns 401", async () => {
    const res = await request(unauthApp).get("/api/api-keys");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/unauthorized/i);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("POST /api/api-keys without a session returns 401", async () => {
    const res = await request(unauthApp)
      .post("/api/api-keys")
      .send({ appName: "TestApp", label: "ci key" });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/unauthorized/i);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("DELETE /api/api-keys/:id without a session returns 401", async () => {
    const res = await request(unauthApp).delete("/api/api-keys/1");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/unauthorized/i);
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — authenticated happy paths
// ---------------------------------------------------------------------------

describe("API key routes — authenticated happy paths", () => {
  it("GET /api/api-keys returns 200 with a list of keys", async () => {
    queueSelect([API_KEY_ROW]);

    const res = await request(authApp).get("/api/api-keys");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);

    const key = res.body[0];
    expect(key.id).toBe(API_KEY_ROW.id);
    expect(key.appName).toBe(API_KEY_ROW.appName);
    expect(key.label).toBe(API_KEY_ROW.label);
    expect(key.keyPrefix).toBe(API_KEY_ROW.keyPrefix);
    expect(key.revoked).toBe(false);
    expect(key.lastUsedAt).toBeNull();
    // The raw key hash must never be exposed
    expect(key.keyHash).toBeUndefined();
  });

  it("GET /api/api-keys returns an empty array when no keys exist", async () => {
    queueSelect([]);

    const res = await request(authApp).get("/api/api-keys");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("POST /api/api-keys creates a key and returns 201 with the secret", async () => {
    const insertedRow = { ...API_KEY_ROW };
    queueInsert([insertedRow]);

    const res = await request(authApp)
      .post("/api/api-keys")
      .send({ appName: "MyApp", label: "integration tests" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(insertedRow.id);
    expect(res.body.appName).toBe("MyApp");
    // The one-time secret must be present and have the expected prefix
    expect(typeof res.body.key).toBe("string");
    expect(res.body.key).toMatch(/^ak_/);
    // Hash must not be exposed
    expect(res.body.keyHash).toBeUndefined();
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
  });

  it("POST /api/api-keys returns 400 when appName is missing", async () => {
    const res = await request(authApp)
      .post("/api/api-keys")
      .send({ label: "no app name" });

    expect(res.status).toBe(400);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("DELETE /api/api-keys/:id revokes the key and returns 204", async () => {
    queueUpdate([{ ...API_KEY_ROW, revokedAt: new Date() }]);

    const res = await request(authApp).delete(`/api/api-keys/${API_KEY_ROW.id}`);

    expect(res.status).toBe(204);
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  it("DELETE /api/api-keys/:id returns 404 when the key does not exist", async () => {
    queueUpdate([]); // update returns no rows → not found

    const res = await request(authApp).delete("/api/api-keys/999");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("DELETE /api/api-keys/:id returns 400 when id is not a valid number", async () => {
    const res = await request(authApp).delete("/api/api-keys/not-a-number");

    expect(res.status).toBe(400);
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});
