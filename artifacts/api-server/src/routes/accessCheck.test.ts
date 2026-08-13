/**
 * End-to-end unit tests for the /api/access-check endpoint.
 *
 * The @workspace/db module is fully mocked so no real database is required.
 * Each test controls exactly what each Drizzle query chain returns via the
 * queueSelectResults helper before each request.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoist the mock objects so vi.mock factory can reference them.
// ---------------------------------------------------------------------------
const { mockDb } = vi.hoisted(() => {
  const _selectQueue: unknown[][] = [];

  /** Chainable select builder that resolves to the next queued result. */
  function makeSelectChain(result: unknown[]) {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.innerJoin = () => chain;
    chain.then = (onFulfilled: (v: unknown[]) => unknown) =>
      Promise.resolve(result).then(onFulfilled);
    return chain;
  }

  /** Chainable update builder (fire-and-forget side effect). */
  function makeUpdateChain() {
    const chain: Record<string, unknown> = {};
    chain.set = () => chain;
    chain.where = () => chain;
    chain.then = (onFulfilled: (v: undefined) => unknown) =>
      Promise.resolve(undefined).then(onFulfilled);
    return chain;
  }

  const mockDb = {
    _selectQueue,
    select: vi.fn(() => makeSelectChain(_selectQueue.shift() ?? [])),
    update: vi.fn(() => makeUpdateChain()),
  };

  return { mockDb };
});

// ---------------------------------------------------------------------------
// Mock @workspace/db before the router is imported.
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => ({
  db: mockDb,
  // Table references are only used as query-builder arguments; shape irrelevant.
  apiKeysTable: {},
  usersTable: {},
  roleAssignmentsTable: {},
  rolesTable: {},
  accessGrantsTable: {},
  resourcesTable: {},
  appsTable: {},
}));

// ---------------------------------------------------------------------------
// Mock the audit logger so tests don't require a real DB insert.
// ---------------------------------------------------------------------------
const mockLogAudit = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/audit", () => ({
  logAudit: (...args: unknown[]) => mockLogAudit(...args),
}));

// ---------------------------------------------------------------------------
// Import router AFTER the mock is wired up.
// ---------------------------------------------------------------------------
import accessCheckRouter, { hashApiKey } from "./accessCheck";

// ---------------------------------------------------------------------------
// Minimal Express app – no session middleware needed.
// ---------------------------------------------------------------------------
function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", accessCheckRouter);
  return app;
}

const app = buildApp();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Enqueue results for sequential db.select() calls within one request. */
function queueSelectResults(...results: unknown[][]): void {
  for (const r of results) {
    mockDb._selectQueue.push(r);
  }
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const VALID_RAW_KEY = "ak_" + "a".repeat(64);
const VALID_KEY_HASH = hashApiKey(VALID_RAW_KEY);

const ACTIVE_API_KEY = {
  id: 1,
  appName: "MyApp",
  label: "test key",
  keyHash: VALID_KEY_HASH,
  keyPrefix: VALID_RAW_KEY.slice(0, 10),
  createdAt: new Date("2025-01-01T00:00:00Z"),
  revokedAt: null,
  lastUsedAt: null,
};

const ACTIVE_USER = {
  id: 10,
  name: "Alice",
  email: "alice@example.com",
  status: "active",
  entraObjectId: "user-oid-123",
  createdAt: new Date("2025-01-01T00:00:00Z"),
};

const ROLE_ROW = { roleId: 5, roleName: "Editor" };

const PERMISSION_ROW = {
  roleId: 5,
  resource: "Documents",
  level: "read & write",
  appName: "MyApp",
};

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockDb._selectQueue.length = 0;
  vi.clearAllMocks();

  // Re-wire implementations after clearAllMocks.
  mockDb.select.mockImplementation(() => {
    const result = mockDb._selectQueue.shift() ?? [];
    return makeSelectChain(result);
  });
  mockDb.update.mockImplementation(() => makeUpdateChain());
  mockLogAudit.mockResolvedValue(undefined);
});

afterEach(() => {
  mockDb._selectQueue.length = 0;
});

/** Chainable select builder (also used in beforeEach after clearAllMocks). */
function makeSelectChain(result: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.innerJoin = () => chain;
  chain.then = (onFulfilled: (v: unknown[]) => unknown) =>
    Promise.resolve(result).then(onFulfilled);
  return chain;
}

/** Chainable update builder (also used in beforeEach after clearAllMocks). */
function makeUpdateChain() {
  const chain: Record<string, unknown> = {};
  chain.set = () => chain;
  chain.where = () => chain;
  chain.then = (onFulfilled: (v: undefined) => unknown) =>
    Promise.resolve(undefined).then(onFulfilled);
  return chain;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/access-check", () => {
  // -------------------------------------------------------------------------
  // Authentication layer
  // -------------------------------------------------------------------------

  it("returns 401 when X-API-Key header is missing", async () => {
    const res = await request(app)
      .get("/api/access-check")
      .query({ entraObjectId: "oid-1", app: "MyApp" });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/missing api key/i);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("returns 401 when the API key is not found in the database", async () => {
    queueSelectResults([]); // api_keys lookup returns nothing

    const res = await request(app)
      .get("/api/access-check")
      .set("X-API-Key", "ak_does_not_exist")
      .query({ entraObjectId: "oid-1", app: "MyApp" });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid or revoked/i);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("returns 401 when the API key has been revoked (query filters it out)", async () => {
    // The route filters with isNull(revokedAt), so a revoked key returns no row.
    queueSelectResults([]);

    const res = await request(app)
      .get("/api/access-check")
      .set("X-API-Key", VALID_RAW_KEY)
      .query({ entraObjectId: "oid-1", app: "MyApp" });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid or revoked/i);
  });

  // -------------------------------------------------------------------------
  // App-scoping
  // -------------------------------------------------------------------------

  it("returns 403 when the API key is valid but scoped to a different app", async () => {
    queueSelectResults([ACTIVE_API_KEY]); // key is for "MyApp"

    const res = await request(app)
      .get("/api/access-check")
      .set("X-API-Key", VALID_RAW_KEY)
      .query({ entraObjectId: ACTIVE_USER.entraObjectId, app: "OtherApp" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not authorized for app/i);
  });

  // -------------------------------------------------------------------------
  // last_used_at stamping
  // -------------------------------------------------------------------------

  it("stamps last_used_at on authenticated calls (even when access is denied)", async () => {
    // Valid key → valid user → no roles → denied, but update must still fire.
    queueSelectResults(
      [ACTIVE_API_KEY], // api_keys
      [ACTIVE_USER],    // users
      [],               // role_assignments → none
    );

    await request(app)
      .get("/api/access-check")
      .set("X-API-Key", VALID_RAW_KEY)
      .query({ entraObjectId: ACTIVE_USER.entraObjectId, app: "MyApp" });

    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  it("does NOT stamp last_used_at when the key fails authentication", async () => {
    queueSelectResults([]); // key not found

    await request(app)
      .get("/api/access-check")
      .set("X-API-Key", "bad-key")
      .query({ entraObjectId: "oid-1", app: "MyApp" });

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // User-level deny cases
  // -------------------------------------------------------------------------

  it("returns denied when the user is not registered in the Admin Console", async () => {
    queueSelectResults(
      [ACTIVE_API_KEY], // api_keys
      [],               // users → not found
    );

    const res = await request(app)
      .get("/api/access-check")
      .set("X-API-Key", VALID_RAW_KEY)
      .query({ entraObjectId: "unknown-oid", app: "MyApp" });

    expect(res.status).toBe(200);
    expect(res.body.allowed).toBe(false);
    expect(res.body.reason).toMatch(/not registered/i);
    expect(res.body.roles).toEqual([]);
    expect(res.body.permissions).toEqual([]);
  });

  it("returns denied with user details when the user is disabled", async () => {
    const disabledUser = { ...ACTIVE_USER, status: "disabled" };
    queueSelectResults(
      [ACTIVE_API_KEY],
      [disabledUser],
    );

    const res = await request(app)
      .get("/api/access-check")
      .set("X-API-Key", VALID_RAW_KEY)
      .query({ entraObjectId: disabledUser.entraObjectId, app: "MyApp" });

    expect(res.status).toBe(200);
    expect(res.body.allowed).toBe(false);
    expect(res.body.reason).toMatch(/disabled/i);
    expect(res.body.userName).toBe(disabledUser.name);
    expect(res.body.status).toBe("disabled");
    expect(res.body.roles).toEqual([]);
    expect(res.body.permissions).toEqual([]);
  });

  it("returns denied when the user is active but has no roles assigned", async () => {
    queueSelectResults(
      [ACTIVE_API_KEY],
      [ACTIVE_USER],
      [], // role_assignments
    );

    const res = await request(app)
      .get("/api/access-check")
      .set("X-API-Key", VALID_RAW_KEY)
      .query({ entraObjectId: ACTIVE_USER.entraObjectId, app: "MyApp" });

    expect(res.status).toBe(200);
    expect(res.body.allowed).toBe(false);
    expect(res.body.reason).toMatch(/no roles/i);
  });

  it("returns denied when user has roles but no grants exist for the requested app", async () => {
    const wrongAppPermission = { ...PERMISSION_ROW, appName: "SomeOtherApp" };
    queueSelectResults(
      [ACTIVE_API_KEY],
      [ACTIVE_USER],
      [ROLE_ROW],
      [wrongAppPermission], // all grants are for a different app
    );

    const res = await request(app)
      .get("/api/access-check")
      .set("X-API-Key", VALID_RAW_KEY)
      .query({ entraObjectId: ACTIVE_USER.entraObjectId, app: "MyApp" });

    expect(res.status).toBe(200);
    expect(res.body.allowed).toBe(false);
    expect(res.body.reason).toMatch(/no permissions for app/i);
    expect(res.body.permissions).toEqual([]);
  });

  it("returns denied when grants exist for the right app but belong to unassigned roles", async () => {
    // User has role id 5; the only grant is for role id 99.
    const unrelatedPermission = { ...PERMISSION_ROW, roleId: 99 };
    queueSelectResults(
      [ACTIVE_API_KEY],
      [ACTIVE_USER],
      [ROLE_ROW],              // user has roleId 5
      [unrelatedPermission],   // grant is for roleId 99 → no match
    );

    const res = await request(app)
      .get("/api/access-check")
      .set("X-API-Key", VALID_RAW_KEY)
      .query({ entraObjectId: ACTIVE_USER.entraObjectId, app: "MyApp" });

    expect(res.status).toBe(200);
    expect(res.body.allowed).toBe(false);
    expect(res.body.reason).toMatch(/no permissions for app/i);
  });

  // -------------------------------------------------------------------------
  // Allow path
  // -------------------------------------------------------------------------

  it("returns allowed with correct roles and permissions for a fully valid request", async () => {
    queueSelectResults(
      [ACTIVE_API_KEY],
      [ACTIVE_USER],
      [ROLE_ROW],
      [PERMISSION_ROW],
    );

    const res = await request(app)
      .get("/api/access-check")
      .set("X-API-Key", VALID_RAW_KEY)
      .query({ entraObjectId: ACTIVE_USER.entraObjectId, app: "MyApp" });

    expect(res.status).toBe(200);
    expect(res.body.allowed).toBe(true);
    expect(res.body.reason).toBeNull();
    expect(res.body.userName).toBe(ACTIVE_USER.name);
    expect(res.body.status).toBe("active");
    expect(res.body.roles).toEqual(["Editor"]);
    expect(res.body.permissions).toEqual([
      { resource: "Documents", level: "read & write" },
    ]);
  });

  it("returns the highest permission level when a resource has multiple grants", async () => {
    const role2 = { roleId: 6, roleName: "Viewer" };
    const viewGrant = { roleId: 6, resource: "Documents", level: "view", appName: "MyApp" };
    const fullGrant = { roleId: 5, resource: "Documents", level: "full rights", appName: "MyApp" };

    queueSelectResults(
      [ACTIVE_API_KEY],
      [ACTIVE_USER],
      [ROLE_ROW, role2],
      [viewGrant, fullGrant],
    );

    const res = await request(app)
      .get("/api/access-check")
      .set("X-API-Key", VALID_RAW_KEY)
      .query({ entraObjectId: ACTIVE_USER.entraObjectId, app: "MyApp" });

    expect(res.status).toBe(200);
    expect(res.body.allowed).toBe(true);
    expect(res.body.permissions).toEqual([
      { resource: "Documents", level: "full rights" },
    ]);
  });

  it("returns permissions across multiple distinct resources", async () => {
    const docGrant = { roleId: 5, resource: "Documents", level: "view", appName: "MyApp" };
    const reportGrant = { roleId: 5, resource: "Reports", level: "read & write", appName: "MyApp" };

    queueSelectResults(
      [ACTIVE_API_KEY],
      [ACTIVE_USER],
      [ROLE_ROW],
      [docGrant, reportGrant],
    );

    const res = await request(app)
      .get("/api/access-check")
      .set("X-API-Key", VALID_RAW_KEY)
      .query({ entraObjectId: ACTIVE_USER.entraObjectId, app: "MyApp" });

    expect(res.status).toBe(200);
    expect(res.body.allowed).toBe(true);
    expect(res.body.permissions).toHaveLength(2);
    const resourceNames = res.body.permissions.map((p: { resource: string }) => p.resource);
    expect(resourceNames).toContain("Documents");
    expect(resourceNames).toContain("Reports");
  });

  it("app name matching is case-insensitive (key scoped to 'MyApp', request uses 'myapp')", async () => {
    queueSelectResults(
      [ACTIVE_API_KEY],   // appName = "MyApp"
      [ACTIVE_USER],
      [ROLE_ROW],
      [PERMISSION_ROW],   // appName = "MyApp" → still matches "myapp"
    );

    const res = await request(app)
      .get("/api/access-check")
      .set("X-API-Key", VALID_RAW_KEY)
      .query({ entraObjectId: ACTIVE_USER.entraObjectId, app: "myapp" });

    expect(res.status).toBe(200);
    expect(res.body.allowed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------

  it("returns 400 when entraObjectId query param is missing", async () => {
    queueSelectResults([ACTIVE_API_KEY]);

    const res = await request(app)
      .get("/api/access-check")
      .set("X-API-Key", VALID_RAW_KEY)
      .query({ app: "MyApp" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/entraObjectId/i);
  });

  it("returns 400 when app query param is missing", async () => {
    queueSelectResults([ACTIVE_API_KEY]);

    const res = await request(app)
      .get("/api/access-check")
      .set("X-API-Key", VALID_RAW_KEY)
      .query({ entraObjectId: "oid-1" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/app/i);
  });

  // -------------------------------------------------------------------------
  // Audit logging
  // -------------------------------------------------------------------------

  describe("audit logging", () => {
    it("logs ACCESS_DENIED when the X-API-Key header is missing entirely", async () => {
      await request(app)
        .get("/api/access-check")
        .query({ entraObjectId: "oid-1", app: "MyApp" });

      expect(mockLogAudit).toHaveBeenCalledOnce();
      const [action, entity, detail, actor] = mockLogAudit.mock.calls[0];
      expect(action).toBe("ACCESS_DENIED");
      expect(entity).toBe("oid-1");
      expect(detail).toContain("missing");
      expect(detail).toContain("MyApp");
      expect(actor).toBe("unknown");
    });

    it("logs ACCESS_DENIED with a key fingerprint when an invalid/revoked API key is provided", async () => {
      queueSelectResults([]); // key not found in DB

      await request(app)
        .get("/api/access-check")
        .set("X-API-Key", "bad-key-xyz")
        .query({ entraObjectId: "oid-1", app: "MyApp" });

      expect(mockLogAudit).toHaveBeenCalledOnce();
      const [action, entity, detail, actor] = mockLogAudit.mock.calls[0];
      expect(action).toBe("ACCESS_DENIED");
      expect(entity).toBe("oid-1");
      // First 10 chars of "bad-key-xyz" is "bad-key-xy"
      expect(detail).toContain("bad-key-xy");
      expect(detail).toContain("Invalid or revoked");
      expect(actor).toContain("bad-key-xy");
    });

    it("logs ACCESS_DENIED when API key is valid but scoped to a different app", async () => {
      queueSelectResults([ACTIVE_API_KEY]); // key for "MyApp"

      await request(app)
        .get("/api/access-check")
        .set("X-API-Key", VALID_RAW_KEY)
        .query({ entraObjectId: ACTIVE_USER.entraObjectId, app: "OtherApp" });

      expect(mockLogAudit).toHaveBeenCalledOnce();
      const [action, entity, detail, actor] = mockLogAudit.mock.calls[0];
      expect(action).toBe("ACCESS_DENIED");
      expect(entity).toBe(ACTIVE_USER.entraObjectId);
      expect(detail).toContain(ACTIVE_API_KEY.keyPrefix);
      expect(detail).toContain("OtherApp");
      expect(actor).toContain(ACTIVE_API_KEY.keyPrefix);
    });

    it("logs ACCESS_DENIED when the user is not registered", async () => {
      queueSelectResults([ACTIVE_API_KEY], []); // users → not found

      await request(app)
        .get("/api/access-check")
        .set("X-API-Key", VALID_RAW_KEY)
        .query({ entraObjectId: "unknown-oid", app: "MyApp" });

      expect(mockLogAudit).toHaveBeenCalledOnce();
      const [action, entity, detail, actor] = mockLogAudit.mock.calls[0];
      expect(action).toBe("ACCESS_DENIED");
      expect(entity).toBe("unknown-oid");
      expect(detail).toContain(ACTIVE_API_KEY.keyPrefix);
      expect(detail).toContain("not registered");
      expect(actor).toContain(ACTIVE_API_KEY.keyPrefix);
    });

    it("logs ACCESS_DENIED with reason when user is disabled", async () => {
      const disabledUser = { ...ACTIVE_USER, status: "disabled" };
      queueSelectResults([ACTIVE_API_KEY], [disabledUser]);

      await request(app)
        .get("/api/access-check")
        .set("X-API-Key", VALID_RAW_KEY)
        .query({ entraObjectId: ACTIVE_USER.entraObjectId, app: "MyApp" });

      expect(mockLogAudit).toHaveBeenCalledOnce();
      const [action, entity, detail] = mockLogAudit.mock.calls[0];
      expect(action).toBe("ACCESS_DENIED");
      expect(entity).toBe(ACTIVE_USER.entraObjectId);
      expect(detail).toContain("disabled");
    });

    it("logs ACCESS_DENIED when user has no roles", async () => {
      queueSelectResults([ACTIVE_API_KEY], [ACTIVE_USER], []); // no roles

      await request(app)
        .get("/api/access-check")
        .set("X-API-Key", VALID_RAW_KEY)
        .query({ entraObjectId: ACTIVE_USER.entraObjectId, app: "MyApp" });

      expect(mockLogAudit).toHaveBeenCalledOnce();
      const [action, , detail] = mockLogAudit.mock.calls[0];
      expect(action).toBe("ACCESS_DENIED");
      expect(detail).toContain("no roles");
    });

    it("logs ACCESS_DENIED when user has no permissions for the app", async () => {
      const wrongAppPermission = { ...PERMISSION_ROW, appName: "SomeOtherApp" };
      queueSelectResults([ACTIVE_API_KEY], [ACTIVE_USER], [ROLE_ROW], [wrongAppPermission]);

      await request(app)
        .get("/api/access-check")
        .set("X-API-Key", VALID_RAW_KEY)
        .query({ entraObjectId: ACTIVE_USER.entraObjectId, app: "MyApp" });

      expect(mockLogAudit).toHaveBeenCalledOnce();
      const [action, , detail] = mockLogAudit.mock.calls[0];
      expect(action).toBe("ACCESS_DENIED");
      expect(detail).toContain("no permissions");
    });

    it("logs ACCESS_ALLOWED for a fully valid request", async () => {
      queueSelectResults([ACTIVE_API_KEY], [ACTIVE_USER], [ROLE_ROW], [PERMISSION_ROW]);

      await request(app)
        .get("/api/access-check")
        .set("X-API-Key", VALID_RAW_KEY)
        .query({ entraObjectId: ACTIVE_USER.entraObjectId, app: "MyApp" });

      expect(mockLogAudit).toHaveBeenCalledOnce();
      const [action, entity, detail, actor] = mockLogAudit.mock.calls[0];
      expect(action).toBe("ACCESS_ALLOWED");
      expect(entity).toBe(ACTIVE_USER.entraObjectId);
      expect(detail).toContain(ACTIVE_API_KEY.keyPrefix);
      expect(detail).toContain("MyApp");
      expect(actor).toContain(ACTIVE_API_KEY.keyPrefix);
    });
  });
});
