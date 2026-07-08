import { db, auditLogTable } from "@workspace/db";

export async function logAudit(
  action: string,
  entity: string,
  detail: string,
  actor: string = "System Administrator",
): Promise<void> {
  await db.insert(auditLogTable).values({
    action,
    entity,
    detail,
    actor,
  });
}
