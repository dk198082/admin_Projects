import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, securityPoliciesTable, appsTable } from "@workspace/db";
import {
  ListSecurityPoliciesResponse,
  UpdateSecurityPolicyParams,
  UpdateSecurityPolicyBody,
  UpdateSecurityPolicyResponse,
} from "@workspace/api-zod";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();

function policySelect() {
  return db
    .select({
      id: securityPoliciesTable.id,
      appId: appsTable.id,
      appName: appsTable.name,
      authMethod: securityPoliciesTable.authMethod,
      mfaRequired: securityPoliciesTable.mfaRequired,
      sessionTimeoutMinutes: securityPoliciesTable.sessionTimeoutMinutes,
      recordLevelScope: securityPoliciesTable.recordLevelScope,
      fieldLevelRules: securityPoliciesTable.fieldLevelRules,
      auditLogging: securityPoliciesTable.auditLogging,
      dataExportPolicy: securityPoliciesTable.dataExportPolicy,
    })
    .from(securityPoliciesTable)
    .innerJoin(appsTable, eq(securityPoliciesTable.appId, appsTable.id));
}

router.get("/security-policies", async (_req, res): Promise<void> => {
  const rows = await policySelect().orderBy(asc(appsTable.id));
  res.json(ListSecurityPoliciesResponse.parse(rows));
});

router.patch("/security-policies/:id", async (req, res): Promise<void> => {
  const params = UpdateSecurityPolicyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateSecurityPolicyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [updated] = await db
    .update(securityPoliciesTable)
    .set(parsed.data)
    .where(eq(securityPoliciesTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Policy not found" });
    return;
  }
  const [row] = await policySelect().where(eq(securityPoliciesTable.id, updated.id));
  await logAudit("update", "Security Policy", `Updated security policy for ${row.appName}`);
  res.json(UpdateSecurityPolicyResponse.parse(row));
});

export default router;
