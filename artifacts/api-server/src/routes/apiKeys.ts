import { randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, apiKeysTable } from "@workspace/db";
import {
  CreateApiKeyBody,
  CreateApiKeyResponse,
  ListApiKeysResponse,
  RevokeApiKeyParams,
} from "@workspace/api-zod";
import { logAudit } from "../lib/audit";
import { hashApiKey } from "./accessCheck";

const router: IRouter = Router();

router.get("/api-keys", async (_req, res): Promise<void> => {
  const rows = await db.select().from(apiKeysTable).orderBy(desc(apiKeysTable.createdAt));
  res.json(
    ListApiKeysResponse.parse(
      rows.map((r) => ({
        id: r.id,
        appName: r.appName,
        label: r.label,
        keyPrefix: r.keyPrefix,
        createdAt: r.createdAt.toISOString(),
        revoked: r.revokedAt !== null,
        lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
      })),
    ),
  );
});

router.post("/api-keys", async (req, res): Promise<void> => {
  const parsed = CreateApiKeyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const secret = `ak_${randomBytes(32).toString("hex")}`;
  const keyPrefix = secret.slice(0, 10);
  const [row] = await db
    .insert(apiKeysTable)
    .values({
      appName: parsed.data.appName.trim(),
      label: parsed.data.label?.trim() ?? "",
      keyHash: hashApiKey(secret),
      keyPrefix,
    })
    .returning();
  await logAudit(
    "create",
    "API Key",
    `Created API key ${keyPrefix}... for ${row.appName}`,
    req.session.user?.name,
  );
  res.status(201).json(
    CreateApiKeyResponse.parse({
      id: row.id,
      appName: row.appName,
      label: row.label,
      keyPrefix: row.keyPrefix,
      createdAt: row.createdAt.toISOString(),
      key: secret,
    }),
  );
});

router.delete("/api-keys/:id", async (req, res): Promise<void> => {
  const params = RevokeApiKeyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .update(apiKeysTable)
    .set({ revokedAt: new Date() })
    .where(eq(apiKeysTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "API key not found" });
    return;
  }
  await logAudit(
    "revoke",
    "API Key",
    `Revoked API key ${row.keyPrefix}... for ${row.appName}`,
    req.session.user?.name,
  );
  res.sendStatus(204);
});

export default router;
