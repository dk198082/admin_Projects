import { db, auditLogTable } from "@workspace/db";

export async function logAudit(
  action: string,
  entity: string,
  detail: string,
): Promise<void> {
  await db.insert(auditLogTable).values({
    action,
    entity,
    detail,
    actor: "System Administrator",
  });
}
