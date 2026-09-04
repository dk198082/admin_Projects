/**
 * Auth-enforcement tests for the /api/api-keys routes.
 *
 * These tests import the REAL composed router from index.ts so that any
 * accidental reordering of requireAuth in that file will cause the
 * unauthenticated assertions to fail. This verifies the actual production
 * route wiring, not a hand-rolled test fixture.
 *
 * All transitive dependencies of the composed router are mocked so that no
 * real database, OIDC provider, or Graph API connection is required.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { type Express, type Request } from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoist the db mock so vi.mock factories can close over it.
// ---------------------------------------------------------------------------
const { mockDb } = vi.hoisted(() => {
  const _insertQueue: unknown[][] = [];
  const _updateQueue: unknown[][] = [];

  function makeSelectChain(result: unknown[]) {
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.where = () => c;
    c.orderBy = () => c;
    c.innerJoin = () => c;
    c.then = (f: (v: unknown[]) => unknown) => Promise.resolve(result).then(f);
    return c;
  }

  function makeInsertChain(result: unknown[]) {
    const c: Record<string, unknown> = {};
    c.values = () => c;
    c.onConflictDoUpdate = () => c;
    c.returning = () => Promise.resolve(result);
    return c;
  }

  function makeUpdateChain(result: unknown[]) {
    const c: Record<string, unknown> = {};
    c.set = () => c;
    c.where = () => c;
    c.returning = () => Promise.resolve(result);
    return c;
  }

  const mockDb = {
    _insertQueue,
    _updateQueue,
    select: vi.fn(() => makeSelectChain([])),
    insert: vi.fn(() => makeInsertChain(_insertQueue.shift() ?? [])),
    update: vi.fn(() => makeUpdateChain(_updateQueue.shift() ?? [])),
  };

  return { mockDb };
});

// ---------------------------------------------------------------------------
// Mock all transitive dependencies of the composed router.
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: mockDb,
  apiKeysTable: {},
  usersTable: {},
  rolesTable: {},
  roleAssignmentsTable: {},
  accessGrantsTable: {},
  resourcesTable: {},
  appsTable: {},
  appUsersTable: {},
  securityPoliciesTable: {},
}));

vi.mock("../lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("openid-client", () => ({
  randomPKCECodeVerifier: vi.fn().mockReturnValue("verifier"),
  calculatePKCECodeChallenge: vi.fn().mockResolvedValue("challenge"),
  randomState: vi.fn().mockReturnValue("state"),
  buildAuthorizationUrl: vi.fn().mockReturnValue({ href: "https://login.example.com/auth" }),
  authorizationCodeGrant: vi.fn().mockResolvedValue({ claims: () => ({ sub: "test" }) }),
}));

vi.mock("../lib/oidc", () => ({
  getOidcConfig: vi.fn().mockResolvedValue({}),
  getRedirectUri: vi.fn().mockReturnValue("https://example.com/api/auth/callback"),
}));

vi.mock("../lib/graph", () => ({
  searchDirectoryUsers: vi.fn().mockResolvedValue([]),
  GraphPermissionError: class GraphPermissionError extends Error {},
}));

vi.mock("../lib/entitlements", () => ({
  ENTITLEMENT_LEVELS: {},
  ENTITLEMENT_SUFFIXES: [],
  entitlementRoleName: vi.fn().mockReturnValue(""),
  entitlementLevelFromRoleName: vi.fn().mockReturnValue(null),
  ensureEntitlementsForApp: vi.fn().mockResolvedValue(undefined),
  renameEntitlementsForApp: vi.fn().mockResolvedValue(undefined),
  grantEntitlementsForResource: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/purgeWorkOrder", () => ({
  PURGE_TABLES: [],
  purgeWorkOrder: vi.fn().mockResolvedValue({ deleted: 0, tables: [] }),
}));

vi.mock("@workspace/permission-matrix", () => ({
  buildPermissionMatrixBuffer: vi.fn().mockResolvedValue(Buffer.from("")),
  PERMISSION_MATRIX_FILENAME: "permissions.xlsx",
}));

// ---------------------------------------------------------------------------
// Import the REAL composed router AFTER mocks are in place.
// The middleware order in index.ts is what actually enforces auth; these tests
// will fail if requireAuth is removed or moved after apiKeysRouter there.
// ---------------------------------------------------------------------------
import composedRouter from "./index";

// ---------------------------------------------------------------------------
// App builders
// ---------------------------------------------------------------------------

/** App using the real composed router, no session user — requireAuth rejects. */
function buildUnauthApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", composedRouter);
  return app;
}

/**
 * App using the real composed router, session.user pre-populated before the
 * router runs — requireAuth lets the request through to apiKeysRouter.
 */
function buildAuthApp(): Express {
  const app = express();
  app.use(express.json());
  // Inject a session before the composed router sees the request.
  app.use((req: Request, _res, next) => {
    (req as unknown as { session: { user: { id: number; entraObjectId: string; email: string; name: string } } }).session = {
      user: { id: 1, entraObjectId: "test-oid", email: "test@example.com", name: "Test Admin" },
    };
    next();
  });
  app.use("/api", composedRouter);
  return app;
}

const unauthApp = buildUnauthApp();
const authApp = buildAuthApp();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const API_KEY_ROW = {
  id: 42,
  appName: "EnforcementApp",
  label: "auth test",
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
  const c: Record<string, unknown> = {};
  c.from = () => c;
  c.where = () => c;
  c.orderBy = () => c;
  c.innerJoin = () => c;
  c.then = (f: (v: unknown[]) => unknown) => Promise.resolve(result).then(f);
  return c;
}

function makeInsertChain(result: unknown[]) {
  const c: Record<string, unknown> = {};
  c.values = () => c;
  c.onConflictDoUpdate = () => c;
  c.returning = () => Promise.resolve(result);
  return c;
}

function makeUpdateChain(result: unknown[]) {
  const c: Record<string, unknown> = {};
  c.set = () => c;
  c.where = () => c;
  c.returning = () => Promise.resolve(result);
  return c;
}

beforeEach(() => {
  mockDb._insertQueue.length = 0;
  mockDb._updateQueue.length = 0;
  vi.clearAllMocks();

  mockDb.select.mockImplementation(() => makeSelectChain([]));
  mockDb.insert.mockImplementation(() =>
    makeInsertChain(mockDb._insertQueue.shift() ?? []),
  );
  mockDb.update.mockImplementation(() =>
    makeUpdateChain(mockDb._updateQueue.shift() ?? []),
  );
});

afterEach(() => {
  mockDb._insertQueue.length = 0;
  mockDb._updateQueue.length = 0;
});

// ---------------------------------------------------------------------------
// Tests — unauthenticated callers must be rejected by the real composition
// ---------------------------------------------------------------------------

describe("API key routes — auth enforcement via real index.ts composition", () => {
  describe("unauthenticated requests", () => {
    it("GET /api/api-keys returns 401 — requireAuth is wired before apiKeysRouter", async () => {
      const res = await request(unauthApp).get("/api/api-keys");

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/unauthorized/i);
      // The route handler must never run
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it("POST /api/api-keys returns 401 — requireAuth is wired before apiKeysRouter", async () => {
      const res = await request(unauthApp)
        .post("/api/api-keys")
        .send({ appName: "TestApp", label: "key" });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/unauthorized/i);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("DELETE /api/api-keys/:id returns 401 — requireAuth is wired before apiKeysRouter", async () => {
      const res = await request(unauthApp).delete("/api/api-keys/1");

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/unauthorized/i);
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Authenticated callers must reach the route handlers (not be blocked by
  // requireAuth). The exact response codes are secondary here — the important
  // thing is that the requests are NOT rejected with 401.
  // -------------------------------------------------------------------------

  describe("authenticated requests get past the auth gate", () => {
    it("GET /api/api-keys with a valid session reaches the route handler (not 401)", async () => {
      // select returns an empty list → 200 []
      mockDb.select.mockImplementationOnce(() => makeSelectChain([]));

      const res = await request(authApp).get("/api/api-keys");

      expect(res.status).not.toBe(401);
      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });

    it("POST /api/api-keys with a valid session reaches the route handler (not 401)", async () => {
      mockDb._insertQueue.push([API_KEY_ROW]);

      const res = await request(authApp)
        .post("/api/api-keys")
        .send({ appName: "EnforcementApp", label: "auth test" });

      expect(res.status).not.toBe(401);
      expect(mockDb.insert).toHaveBeenCalledTimes(1);
    });

    it("DELETE /api/api-keys/:id with a valid session reaches the route handler (not 401)", async () => {
      mockDb._updateQueue.push([{ ...API_KEY_ROW, revokedAt: new Date() }]);

      const res = await request(authApp).delete(`/api/api-keys/${API_KEY_ROW.id}`);

      expect(res.status).not.toBe(401);
      expect(mockDb.update).toHaveBeenCalledTimes(1);
    });
  });
});
