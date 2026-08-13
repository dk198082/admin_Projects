/**
 * Integration tests confirming that every route group registered after
 * `requireAuth` in routes/index.ts requires an authenticated session.
 *
 * Strategy: mount the full router (from ./index) on a minimal Express app
 * under /api — the same path used in production.  Two app variants are built:
 *   - unauthApp  — no session.user; requireAuth must reject every probe.
 *   - authApp    — session.user pre-populated; every probe must reach the
 *                  route handler (any status except 401 is acceptable).
 *
 * All external dependencies (@workspace/db, graph, purgeWorkOrder, audit,
 * permission-matrix) are mocked so no real database or network calls occur.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express, type Request } from "express";
import request from "supertest";
import { requireAuth } from "../middlewares/requireAuth";

// ---------------------------------------------------------------------------
// Hoist a generic Proxy-based DB mock that handles any Drizzle chain.
// ---------------------------------------------------------------------------
const { mockDb, mockPool } = vi.hoisted(() => {
  /**
   * Returns a Proxy that accepts any chain of method calls and resolves to
   * `result` when awaited (via `.then`) or when `.returning()` is called.
   */
  function makeChain(result: unknown[] = []): unknown {
    const handler: ProxyHandler<object> = {
      get(_target, prop: string | symbol) {
        if (prop === "then") {
          return (onFulfilled: (v: unknown[]) => unknown) =>
            Promise.resolve(result).then(onFulfilled);
        }
        if (prop === "returning") {
          return () => Promise.resolve(result);
        }
        // Any other method (from, where, orderBy, leftJoin, limit, etc.)
        // returns a new proxy so chains of arbitrary length work.
        return () => new Proxy({}, handler);
      },
    };
    return new Proxy({}, handler);
  }

  const mockDb = {
    select: vi.fn(() => makeChain([])),
    insert: vi.fn(() => makeChain([])),
    update: vi.fn(() => makeChain([])),
    delete: vi.fn(() => makeChain([])),
  };

  const mockPool = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  };

  return { mockDb, mockPool };
});

// ---------------------------------------------------------------------------
// Mock @workspace/db — covers all route files that import from it.
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => ({
  db: mockDb,
  pool: mockPool,
  getDbPoolConfig: vi.fn(() => ({})),
  // Table references — routes import these by name; plain objects are fine.
  usersTable: {},
  rolesTable: {},
  appsTable: {},
  resourcesTable: {},
  accessGrantsTable: {},
  roleAssignmentsTable: {},
  auditLogTable: {},
  apiKeysTable: {},
  securityPoliciesTable: {},
}));

// ---------------------------------------------------------------------------
// Mock @workspace/permission-matrix used by permissionMatrix route.
// ---------------------------------------------------------------------------
vi.mock("@workspace/permission-matrix", () => ({
  buildPermissionMatrixBuffer: vi.fn().mockResolvedValue(Buffer.from("xlsx")),
  PERMISSION_MATRIX_FILENAME: "permission-matrix.xlsx",
}));

// ---------------------------------------------------------------------------
// Mock the Graph API library used by the entra route.
// ---------------------------------------------------------------------------
vi.mock("../lib/graph", () => ({
  searchDirectoryUsers: vi.fn().mockResolvedValue({ value: [] }),
  getSignInLogs: vi.fn().mockResolvedValue({ value: [] }),
  GraphPermissionError: class GraphPermissionError extends Error {},
}));

// ---------------------------------------------------------------------------
// Mock the work-order purge helper.
// ---------------------------------------------------------------------------
vi.mock("../lib/purgeWorkOrder", () => ({
  purgeWorkOrder: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mock the audit logger — side-effect only, not under test here.
// ---------------------------------------------------------------------------
vi.mock("../lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mock drizzle-orm helpers imported by routes (desc, eq, count, sql, etc.).
// ---------------------------------------------------------------------------
vi.mock("drizzle-orm", () => ({
  desc: vi.fn((x: unknown) => x),
  asc: vi.fn((x: unknown) => x),
  eq: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
  count: vi.fn(() => "count"),
  sql: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
  isNotNull: vi.fn(),
  gte: vi.fn(),
  lte: vi.fn(),
  like: vi.fn(),
  ilike: vi.fn(),
  ne: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import the FULL router chain after all mocks are in place.
// ---------------------------------------------------------------------------
import mainRouter from "./index";

// ---------------------------------------------------------------------------
// App builders
// ---------------------------------------------------------------------------

/** Unauthenticated app — requireAuth in the router chain will block every call. */
function buildUnauthApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", mainRouter);
  return app;
}

/**
 * Authenticated app — injects session.user before the router so requireAuth
 * passes through to the actual route handler.
 */
function buildAuthApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res, next) => {
    (req as unknown as { session: { user: { id: number; entraObjectId: string; email: string; name: string } } }).session = {
      user: { id: 1, entraObjectId: "test-oid", email: "test@example.com", name: "Test Admin" },
    };
    next();
  });
  app.use("/api", mainRouter);
  return app;
}

const unauthApp = buildUnauthApp();
const authApp = buildAuthApp();

// ---------------------------------------------------------------------------
// Reset mocks between tests so queues don't bleed across cases.
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  mockPool.query.mockResolvedValue({ rows: [] });
});

// ---------------------------------------------------------------------------
// Representative route for each protected group.
// One row per router registered after requireAuth in routes/index.ts.
// ---------------------------------------------------------------------------
const PROTECTED_ROUTES: Array<{ group: string; method: "get" | "post"; path: string }> = [
  { group: "apiKeys",          method: "get",  path: "/api/api-keys" },
  { group: "users",            method: "get",  path: "/api/users" },
  { group: "roles",            method: "get",  path: "/api/roles" },
  { group: "appsResources",    method: "get",  path: "/api/apps" },
  { group: "grants",           method: "get",  path: "/api/access-grants" },
  { group: "security",         method: "get",  path: "/api/security-policies" },
  { group: "audit",            method: "get",  path: "/api/audit-log" },
  { group: "sync",             method: "get",  path: "/api/sync/error-log" },
  { group: "entra",            method: "get",  path: "/api/entra/users" },
  { group: "permissionMatrix", method: "get",  path: "/api/permission-matrix/export" },
  { group: "accessMapping",    method: "get",  path: "/api/access-mapping" },
  { group: "workOrderPurge",   method: "get",  path: "/api/work-order-purge/search" },
];

// ---------------------------------------------------------------------------
// Tests — unauthenticated callers must receive 401 for every protected route.
// ---------------------------------------------------------------------------

describe("requireAuth — unauthenticated callers are rejected", () => {
  for (const { group, method, path } of PROTECTED_ROUTES) {
    it(`${method.toUpperCase()} ${path} (${group}) returns 401 without a session`, async () => {
      const res = await (request(unauthApp) as unknown as Record<string, (path: string) => request.Test>)[method](path);

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/unauthorized/i);
    });
  }
});

// ---------------------------------------------------------------------------
// Tests — authenticated callers reach the route handler (status ≠ 401).
// Any non-401 status confirms requireAuth passed control to the handler.
// ---------------------------------------------------------------------------

describe("requireAuth — authenticated callers reach the route handler", () => {
  for (const { group, method, path } of PROTECTED_ROUTES) {
    it(`${method.toUpperCase()} ${path} (${group}) does not return 401 with a valid session`, async () => {
      const res = await (request(authApp) as unknown as Record<string, (path: string) => request.Test>)[method](path);

      expect(res.status).not.toBe(401);
    });
  }
});
