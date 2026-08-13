import { and, eq, inArray } from "drizzle-orm";
import { db, rolesTable, resourcesTable, accessGrantsTable } from "@workspace/db";

export const ENTITLEMENT_LEVELS = {
  "Read Only": "View",
  "Read / Write": "Read & Write",
} as const;

export type EntitlementLevel = keyof typeof ENTITLEMENT_LEVELS;

export const ENTITLEMENT_SUFFIXES: EntitlementLevel[] = ["Read Only", "Read / Write"];

export function entitlementRoleName(appName: string, level: EntitlementLevel): string {
  return `${appName} - ${level}`;
}

export function entitlementLevelFromRoleName(
  roleName: string,
  appName: string,
): EntitlementLevel | null {
  for (const level of ENTITLEMENT_SUFFIXES) {
    if (roleName === entitlementRoleName(appName, level)) return level;
  }
  return null;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

/**
 * Ensure the two auto-managed entitlement roles ("<App> - Read Only",
 * "<App> - Read / Write") exist for an app and hold grants covering all of
 * the app's resources at the mapped grant level.
 */
export async function ensureEntitlementsForApp(
  appId: number,
  appName: string,
  tx: Tx = db,
): Promise<void> {
  const resources = await tx
    .select({ id: resourcesTable.id })
    .from(resourcesTable)
    .where(eq(resourcesTable.appId, appId));

  for (const level of ENTITLEMENT_SUFFIXES) {
    const name = entitlementRoleName(appName, level);
    let [role] = await tx
      .select()
      .from(rolesTable)
      .where(and(eq(rolesTable.appId, appId), eq(rolesTable.isEntitlement, true), eq(rolesTable.name, name)));
    if (!role) {
      // May exist under an outdated name (e.g. after app rename outside the flow)
      const stale = await tx
        .select()
        .from(rolesTable)
        .where(and(eq(rolesTable.appId, appId), eq(rolesTable.isEntitlement, true)));
      const match = stale.find((r) => r.name.endsWith(` - ${level}`));
      if (match) {
        [role] = await tx
          .update(rolesTable)
          .set({ name })
          .where(eq(rolesTable.id, match.id))
          .returning();
      } else {
        [role] = await tx
          .insert(rolesTable)
          .values({
            name,
            description: `Auto-managed entitlement: ${level} access to all ${appName} resources`,
            appId,
            isEntitlement: true,
          })
          .onConflictDoNothing()
          .returning();
        if (!role) {
          [role] = await tx
            .select()
            .from(rolesTable)
            .where(eq(rolesTable.name, name));
        }
      }
    }
    if (!role) continue;

    if (resources.length > 0) {
      const existing = await tx
        .select({ resourceId: accessGrantsTable.resourceId })
        .from(accessGrantsTable)
        .where(eq(accessGrantsTable.roleId, role.id));
      const have = new Set(existing.map((g) => g.resourceId));
      const missing = resources.filter((r) => !have.has(r.id));
      if (missing.length > 0) {
        await tx.insert(accessGrantsTable).values(
          missing.map((r) => ({
            roleId: role.id,
            resourceId: r.id,
            level: ENTITLEMENT_LEVELS[level],
          })),
        );
      }
    }
  }
}

/** Rename an app's entitlement roles + descriptions after an app rename. */
export async function renameEntitlementsForApp(
  appId: number,
  newAppName: string,
  tx: Tx = db,
): Promise<void> {
  const roles = await tx
    .select()
    .from(rolesTable)
    .where(and(eq(rolesTable.appId, appId), eq(rolesTable.isEntitlement, true)));
  for (const role of roles) {
    const level = ENTITLEMENT_SUFFIXES.find((l) => role.name.endsWith(` - ${l}`));
    if (!level) continue;
    await tx
      .update(rolesTable)
      .set({
        name: entitlementRoleName(newAppName, level),
        description: `Auto-managed entitlement: ${level} access to all ${newAppName} resources`,
      })
      .where(eq(rolesTable.id, role.id));
  }
}

/** Add grants for a newly created resource to its app's entitlement roles. */
export async function grantEntitlementsForResource(
  appId: number,
  resourceId: number,
  tx: Tx = db,
): Promise<void> {
  const roles = await tx
    .select()
    .from(rolesTable)
    .where(and(eq(rolesTable.appId, appId), eq(rolesTable.isEntitlement, true)));
  if (roles.length === 0) return;
  const existing = await tx
    .select({ roleId: accessGrantsTable.roleId })
    .from(accessGrantsTable)
    .where(
      and(
        eq(accessGrantsTable.resourceId, resourceId),
        inArray(
          accessGrantsTable.roleId,
          roles.map((r) => r.id),
        ),
      ),
    );
  const have = new Set(existing.map((g) => g.roleId));
  const values = roles
    .filter((r) => !have.has(r.id))
    .map((r) => {
      const level = ENTITLEMENT_SUFFIXES.find((l) => r.name.endsWith(` - ${l}`)) ?? "Read Only";
      return { roleId: r.id, resourceId, level: ENTITLEMENT_LEVELS[level] };
    });
  if (values.length > 0) {
    await tx.insert(accessGrantsTable).values(values);
  }
}
