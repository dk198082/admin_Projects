import crypto from "node:crypto";
import { pool } from "@workspace/db";

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:80";
const APP_A = "Production Shop Floor";
const APP_B = "Field Service Calendar";

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  const status = ok ? "PASS" : "FAIL";
  if (!ok) failures += 1;
  process.stdout.write(`[${status}] ${name}${detail ? ` — ${detail}` : ""}\n`);
}

async function createSessionCookie(): Promise<{ sid: string; cookie: string }> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Missing SESSION_SECRET");
  const admin = await pool.query(
    "SELECT id, entra_object_id, email, name FROM app_user WHERE entra_object_id IS NOT NULL ORDER BY last_login_at DESC NULLS LAST LIMIT 1",
  );
  const u = admin.rows[0] as
    | { id: number; entra_object_id: string; email: string; name: string }
    | undefined;
  if (!u) throw new Error("No signed-in admin user found to impersonate");
  const sid = `e2e-verify-${crypto.randomBytes(12).toString("hex")}`;
  const sess = {
    cookie: {
      originalMaxAge: 60 * 60 * 1000,
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      httpOnly: true,
      path: "/",
      sameSite: "lax",
    },
    user: { id: u.id, entraObjectId: u.entra_object_id, email: u.email, name: u.name },
  };
  await pool.query(
    `INSERT INTO "session" (sid, sess, expire) VALUES ($1, $2::json, NOW() + interval '1 hour')`,
    [sid, JSON.stringify(sess)],
  );
  const sig = crypto.createHmac("sha256", secret).update(sid).digest("base64").replace(/=+$/, "");
  return { sid, cookie: `connect.sid=${encodeURIComponent(`s:${sid}.${sig}`)}` };
}

async function api<T>(
  cookie: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: T }> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : null) as T };
}

interface MappingEntry {
  userId: number;
  appId: number;
  appName: string;
  level: string;
}

async function main(): Promise<void> {
  const { sid, cookie } = await createSessionCookie();
  const suffix = crypto.randomBytes(4).toString("hex");
  const userIds: number[] = [];
  try {
    const me = await api<{ name: string }>(cookie, "GET", "/auth/me");
    check("Injected session is authenticated", me.status === 200, `signed in as ${me.json?.name}`);

    const apps = await api<{ id: number; name: string }[]>(cookie, "GET", "/apps");
    const appA = apps.json.find((a) => a.name === APP_A);
    const appB = apps.json.find((a) => a.name === APP_B);
    if (!appA || !appB) throw new Error(`Apps "${APP_A}" / "${APP_B}" not found`);

    const names = [`E2E Verify Alpha ${suffix}`, `E2E Verify Beta ${suffix}`];
    for (const name of names) {
      const created = await api<{ id: number }>(cookie, "POST", "/users", {
        name,
        email: `e2e.${name.toLowerCase().replace(/\s+/g, ".")}@test.local`,
      });
      if (created.status !== 201 && created.status !== 200)
        throw new Error(`Failed to create test user (${created.status})`);
      userIds.push(created.json.id);
    }
    const [alphaId, betaId] = userIds;

    // 1. Grant mode: multi-user x multi-app
    const grant = await api<{ assigned: number; updated: number; skipped: number }>(
      cookie,
      "POST",
      "/access-mapping/assign",
      { userIds, appIds: [appA.id, appB.id], level: "Read Only" },
    );
    check(
      "Grant: 2 users x 2 apps Read Only assigns 4",
      grant.status === 200 && grant.json.assigned === 4,
      JSON.stringify(grant.json),
    );
    let mapping = await api<MappingEntry[]>(cookie, "GET", "/access-mapping");
    const mine = (): MappingEntry[] => mapping.json.filter((e) => userIds.includes(e.userId));
    check(
      "Grant: 4 Read Only entries visible in mapping",
      mine().length === 4 && mine().every((e) => e.level === "Read Only"),
    );

    // 2. Inline level change: Read Only -> Read / Write, persists
    const upgrade = await api<{ assigned: number; updated: number; skipped: number }>(
      cookie,
      "POST",
      "/access-mapping/assign",
      { userIds: [alphaId], appIds: [appA.id], level: "Read / Write" },
    );
    check(
      "Level change: Read Only -> Read / Write reports updated=1",
      upgrade.status === 200 && upgrade.json.updated === 1,
      JSON.stringify(upgrade.json),
    );
    mapping = await api<MappingEntry[]>(cookie, "GET", "/access-mapping");
    check(
      "Level change persists in mapping",
      mine().some((e) => e.userId === alphaId && e.appId === appA.id && e.level === "Read / Write"),
    );

    // 3. Per-row remove: one user x one app
    const rowRemove = await api<{ removed: number }>(cookie, "POST", "/access-mapping/remove", {
      userIds: [alphaId],
      appIds: [appB.id],
    });
    check(
      "Per-row remove: removes exactly 1",
      rowRemove.status === 200 && rowRemove.json.removed === 1,
      JSON.stringify(rowRemove.json),
    );
    mapping = await api<MappingEntry[]>(cookie, "GET", "/access-mapping");
    check(
      "Per-row remove reflected in mapping (3 entries left)",
      mine().length === 3 && !mine().some((e) => e.userId === alphaId && e.appId === appB.id),
    );

    // 4. Bulk remove mode: multi-user x multi-app
    const bulk = await api<{ removed: number }>(cookie, "POST", "/access-mapping/remove", {
      userIds,
      appIds: [appA.id, appB.id],
    });
    check(
      "Bulk remove: removes remaining 3",
      bulk.status === 200 && bulk.json.removed === 3,
      JSON.stringify(bulk.json),
    );
    mapping = await api<MappingEntry[]>(cookie, "GET", "/access-mapping");
    check("Bulk remove leaves no entries for test users", mine().length === 0);

    // 5. Audit log contains all four actions
    const audit = await api<{ entries?: { action: string; detail: string }[] } | { action: string; detail: string }[]>(
      cookie,
      "GET",
      "/audit-log?limit=50",
    );
    const entries = Array.isArray(audit.json) ? audit.json : (audit.json.entries ?? []);
    const has = (fragment: string): boolean => entries.some((e) => e.detail.includes(fragment));
    check("Audit: grant entry logged", has(`Set Read Only access on ${APP_A}, ${APP_B} for ${names[0]}, ${names[1]}`));
    check("Audit: level change entry logged", has(`Set Read / Write access on ${APP_A} for ${names[0]}`));
    check("Audit: per-row remove entry logged", has(`Removed app access to ${APP_B} for ${names[0]}`));
    check("Audit: bulk remove entry logged", has(`Removed app access to ${APP_A}, ${APP_B} for ${names[0]}, ${names[1]}`));
  } finally {
    for (const id of userIds) {
      await api(cookie, "DELETE", `/users/${id}`);
    }
    await pool.query(`DELETE FROM "session" WHERE sid = $1`, [sid]);
    await pool.end();
  }
  if (failures > 0) {
    process.stdout.write(`\n${failures} check(s) FAILED\n`);
    process.exit(1);
  }
  process.stdout.write("\nAll checks passed\n");
}

main().catch((err) => {
  process.stderr.write(`verify-access-mapping-e2e failed: ${String(err)}\n`);
  process.exit(1);
});
