import { Router, type IRouter } from "express";
import { eq, and, isNotNull } from "drizzle-orm";
import { db, usersTable, roleAssignmentsTable, rolesTable, appsTable } from "@workspace/db";
import { GetMyAppsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * Powers the Workspace Shell's app launcher tiles. Deliberately reuses the
 * SAME entitlement model every satellite app already checks against via
 * /api/access-check (see accessCheck.ts) — a user sees a tile here if and
 * only if they hold at least one role for that app in `role_assignments`.
 * This is presentation-only: hiding a tile here is a convenience, not the
 * security boundary — each satellite app still enforces its own
 * /api/access-check (or local fallback) independently, so a user who
 * navigates to an app's URL directly without a visible tile is still
 * correctly denied by that app, not just left to trust the shell's filtering.
 *
 * Bridges the shell's own login session (keyed by this app's internal
 * appUsersTable.id, see routes/auth.ts) to the shared entitlement directory
 * (usersTable/roleAssignmentsTable, keyed by entraObjectId) — these are two
 * different tables for two different purposes and are NOT the same "user
 * id", which is easy to miss.
 */
router.get("/my-apps", async (req, res): Promise<void> => {
  const sessionUser = req.session.user;
  if (!sessionUser) {
    res.status(401).json({ error: "Not signed in" });
    return;
  }

  const [directoryUser] = await db
    .select({ id: usersTable.id, name: usersTable.name, status: usersTable.status })
    .from(usersTable)
    .where(eq(usersTable.entraObjectId, sessionUser.entraObjectId));

  // A user can be signed into the shell (they have an Admin Console
  // entitlement, checked at login — see auth.ts) without necessarily having
  // a row in the entitlement directory used for OTHER apps' access checks.
  // Rather than error, return an empty app list — an empty workspace is a
  // legitimate, self-explanatory state; a 500 here is not.
  if (!directoryUser || directoryUser.status !== "active") {
    res.json(GetMyAppsResponse.parse({ userName: sessionUser.name, apps: [] }));
    return;
  }

  const rows = await db
    .selectDistinct({
      id: appsTable.id,
      name: appsTable.name,
      description: appsTable.description,
      icon: appsTable.icon,
      category: appsTable.category,
      launchUrl: appsTable.launchUrl,
    })
    .from(roleAssignmentsTable)
    .innerJoin(rolesTable, eq(roleAssignmentsTable.roleId, rolesTable.id))
    .innerJoin(appsTable, eq(rolesTable.appId, appsTable.id))
    .where(
      and(
        eq(roleAssignmentsTable.userId, directoryUser.id),
        // An app with no launchUrl configured yet isn't ready to be a tile —
        // this is what makes onboarding a new app additive/safe: adding the
        // `apps` row and assigning roles doesn't surface a broken tile until
        // someone also sets launchUrl (see docs/workspace/ADDING_NEW_APPS.md).
        isNotNull(appsTable.launchUrl),
      ),
    )
    .orderBy(appsTable.category, appsTable.name);

  res.json(
    GetMyAppsResponse.parse({
      userName: directoryUser.name,
      apps: rows.map((r) => ({ ...r, launchUrl: r.launchUrl! })),
    }),
  );
});

export default router;
