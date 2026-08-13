import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  apiKeysTable,
  usersTable,
  roleAssignmentsTable,
  rolesTable,
  accessGrantsTable,
  resourcesTable,
  appsTable,
} from "@workspace/db";
import { CheckAccessQueryParams, CheckAccessResponse } from "@workspace/api-zod";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

router.get("/access-check", async (req, res): Promise<void> => {
  // Read raw query params early so they can be included in pre-auth audit entries.
  const rawEntraObjectIdEarly =
    typeof req.query.entraObjectId === "string" ? req.query.entraObjectId : "unknown";
  const rawAppEarly = typeof req.query.app === "string" ? req.query.app : "unknown";

  const providedKey = req.header("x-api-key");
  if (!providedKey) {
    await logAudit(
      "ACCESS_DENIED",
      rawEntraObjectIdEarly,
      `key=missing app=${rawAppEarly} reason=Missing API key`,
      "unknown",
    );
    res.status(401).json({ error: "Missing API key (X-API-Key header)" });
    return;
  }
  const [apiKey] = await db
    .select()
    .from(apiKeysTable)
    .where(and(eq(apiKeysTable.keyHash, hashApiKey(providedKey)), isNull(apiKeysTable.revokedAt)));
  if (!apiKey) {
    // Log first 10 chars of the provided key as a fingerprint — never the full value.
    const keyFingerprint = providedKey.slice(0, 10);
    await logAudit(
      "ACCESS_DENIED",
      rawEntraObjectIdEarly,
      `key=${keyFingerprint}… app=${rawAppEarly} reason=Invalid or revoked API key`,
      `key fingerprint: ${keyFingerprint}`,
    );
    res.status(401).json({ error: "Invalid or revoked API key" });
    return;
  }

  if (typeof req.query.entraObjectId !== "string" || rawEntraObjectIdEarly.trim() === "") {
    res.status(400).json({ error: "Missing required query parameter: entraObjectId" });
    return;
  }
  if (typeof req.query.app !== "string" || rawAppEarly.trim() === "") {
    res.status(400).json({ error: "Missing required query parameter: app" });
    return;
  }
  const query = CheckAccessQueryParams.safeParse({ entraObjectId: rawEntraObjectIdEarly, app: rawAppEarly });
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { entraObjectId, app } = query.data;

  if (apiKey.appName.trim().toLowerCase() !== app.trim().toLowerCase()) {
    await logAudit(
      "ACCESS_DENIED",
      entraObjectId,
      `key=${apiKey.keyPrefix} app=${app} reason=API key not authorized for app "${app}"`,
      `API Key: ${apiKey.keyPrefix}`,
    );
    res.status(403).json({ error: `This API key is not authorized for app "${app}"` });
    return;
  }

  await db
    .update(apiKeysTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeysTable.id, apiKey.id));

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.entraObjectId, entraObjectId));

  const deny = async (reason: string, extra?: { userName?: string; status?: string }) => {
    await logAudit(
      "ACCESS_DENIED",
      entraObjectId,
      `key=${apiKey.keyPrefix} app=${app} reason=${reason}`,
      `API Key: ${apiKey.keyPrefix}`,
    );
    res.json(
      CheckAccessResponse.parse({
        allowed: false,
        reason,
        userName: extra?.userName ?? null,
        status: extra?.status ?? null,
        roles: [],
        permissions: [],
      }),
    );
  };

  if (!user) {
    await deny("User is not registered in the Admin Console");
    return;
  }
  if (user.status !== "active") {
    await deny("User is disabled in the Admin Console", { userName: user.name, status: user.status });
    return;
  }

  const roleRows = await db
    .select({ roleId: rolesTable.id, roleName: rolesTable.name })
    .from(roleAssignmentsTable)
    .innerJoin(rolesTable, eq(roleAssignmentsTable.roleId, rolesTable.id))
    .where(eq(roleAssignmentsTable.userId, user.id));

  if (roleRows.length === 0) {
    await deny("User has no roles assigned", { userName: user.name, status: user.status });
    return;
  }

  const permissionRows = await db
    .select({
      roleId: accessGrantsTable.roleId,
      resource: resourcesTable.name,
      level: accessGrantsTable.level,
      appName: appsTable.name,
    })
    .from(accessGrantsTable)
    .innerJoin(resourcesTable, eq(accessGrantsTable.resourceId, resourcesTable.id))
    .innerJoin(appsTable, eq(resourcesTable.appId, appsTable.id));

  const roleIds = new Set(roleRows.map((r) => r.roleId));
  const appLower = app.trim().toLowerCase();
  const matching = permissionRows.filter(
    (p) => roleIds.has(p.roleId) && p.appName.toLowerCase() === appLower,
  );

  if (matching.length === 0) {
    await deny(`User has no permissions for app "${app}"`, {
      userName: user.name,
      status: user.status,
    });
    return;
  }

  const levelRank: Record<string, number> = { view: 1, "read & write": 2, "full rights": 3 };
  const best = new Map<string, string>();
  for (const p of matching) {
    const existing = best.get(p.resource);
    if (
      !existing ||
      (levelRank[p.level.toLowerCase()] ?? 0) > (levelRank[existing.toLowerCase()] ?? 0)
    ) {
      best.set(p.resource, p.level);
    }
  }

  await logAudit(
    "ACCESS_ALLOWED",
    entraObjectId,
    `key=${apiKey.keyPrefix} app=${app}`,
    `API Key: ${apiKey.keyPrefix}`,
  );
  res.json(
    CheckAccessResponse.parse({
      allowed: true,
      reason: null,
      userName: user.name,
      status: user.status,
      roles: roleRows.map((r) => r.roleName),
      permissions: [...best.entries()].map(([resource, level]) => ({ resource, level })),
    }),
  );
});

export default router;
