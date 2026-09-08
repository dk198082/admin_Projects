# Adding a new application to the Digital Workspace

This is the complete, repeatable procedure for bringing a new application
into the workspace. **No changes to the Workspace Shell's code are required**
for any of this — every step is either deploying the new app itself
(unrelated to the Shell) or data entered through the existing Admin Console
UI.

## Before you start

You need:
- The new application already built with its own Entra ID login flow
  (`/api/auth/login`, `/api/auth/callback`, `/api/auth/me`) — copy this from
  any existing app in the workspace (Field Service Calendar, Production
  Calendar) as a starting point if it doesn't have one yet.
- The new application calling this Admin Console's `/api/access-check`
  endpoint to authorize its own users server-side — see any existing app's
  `AZURE_DEPLOYMENT.md` for the exact integration (it needs
  `ADMIN_CONSOLE_URL` and `ADMIN_CONSOLE_API_KEY`). **This step matters even
  though the Shell also filters tiles by entitlement** — the Shell's
  filtering is a convenience, not the security boundary (see
  `FUNCTIONAL_REQUIREMENTS.md`, FR-3). Skipping it means anyone who guesses
  or bookmarks the new app's URL gets in, tile or no tile.
- The new application deployed somewhere reachable (its own Azure App
  Service/Container App is the standard pattern in this workspace, per
  `TECHNICAL_DESIGN.md` §8).

## Step 1 — Register the app in Entra ID

Follow `TECHNICAL_DESIGN.md` §8.4 exactly, **in the same tenant** as every
other app in the workspace. This is the step that determines whether SSO
will actually work for this app — an app registered in a different tenant
will never share the workspace's single sign-on session, and there's no
error message that will tell you that's what happened; it'll just always
prompt for login. Double-check the tenant ID before moving on.

## Step 2 — Deploy the app to Azure

Standard deployment for this app — outside the scope of the workspace
itself. Get its production URL (e.g. `https://newapp.contoso.com`).

## Step 3 — Onboard it in the Admin Console

1. Sign into the Admin Console (`/admin-console/`, or via its own tile once
   you can see it — see Step 5).
2. Go to **Security** → **Add App** → enter its name.

This creates the `apps` row. At this point the app exists in the
entitlement system, but **is not yet visible in the Workspace** (no
`launchUrl` set yet — this is intentional, see Step 5).

## Step 4 — Create roles and assign access

1. Go to **Permissions** → select the new app → create at least one role
   (mark it as an entitlement role if it should gate login the way
   `Admin Console Access` does for this app itself — see the Admin
   Console's own `AZURE_DEPLOYMENT.md` bootstrap section for what that
   means in practice).
2. Go to **Map User Security Access** (or the relevant user page) → assign
   the role to whichever users should have access.

Nobody sees a tile for this app yet — a role assignment alone isn't enough
(see FR-2.3). This ordering is deliberate: you can fully set up who has
access to a brand-new app, days before it's actually ready to launch,
without any risk of a half-configured app appearing in anyone's workspace.

## Step 5 — Set the app's Workspace tile

1. Go to **Security** → scroll to **Workspace Tiles**.
2. Find the new app in the list → **Edit tile**.
3. Fill in:
   - **Launch URL** — the app's production URL from Step 2. **This is the
     field that makes the tile appear** — leaving it blank keeps the app
     invisible in the Workspace regardless of role assignments.
   - **Description** — one short line, shown under the app's name on its
     tile.
   - **Icon** — pick from the dropdown. If the app needs an icon not in the
     list, see "Adding a new icon" below before this step.
   - **Category** — groups this tile with others (e.g. "Field Operations").
     Use an existing category name to group it with related apps, or a new
     one to create a new group.
4. Save.

Every user with a role assignment for this app now sees its tile the next
time they load (or reload) the Workspace — no restart, no deployment, no
Shell code change.

## Adding a new icon

The Workspace Tiles dropdown is intentionally restricted to icon names that
are guaranteed to render — this is the one case that touches code, and it's
a two-line change:

1. Pick an icon name from [lucide.dev/icons](https://lucide.dev/icons) —
   use its exact PascalCase export name (e.g. `Clipboard`, `Truck`).
2. Add it to **both** of these lists (they must stay in sync — see the
   comment in each file):
   - `artifacts/workspace-shell/src/lib/icons.ts` — the `ICON_REGISTRY`
     import and object entry (this is what actually renders).
   - `artifacts/admin-console/src/components/WorkspaceTilesSection.tsx` —
     the `ICON_OPTIONS` array (this is what an admin can pick from).
3. Rebuild and redeploy the Workspace Shell / Admin Console container (both
   frontends live in the same image — see `TECHNICAL_DESIGN.md` §8.2).

If you skip this and an admin somehow sets an icon name that isn't
registered (e.g. by a future direct API call), the tile still renders —
`resolveIcon()` falls back to a generic grid icon rather than breaking.

## Verifying it worked

1. As a user who was assigned a role in Step 4: load the Workspace, confirm
   the new tile appears with the right name, description, icon, and
   category.
2. Click it — confirm it opens the new app **without a visible login
   prompt** (a brief redirect flash is normal and expected, per
   `TECHNICAL_DESIGN.md` §3.2).
3. As a user who was *not* assigned a role: confirm the tile does **not**
   appear.
4. As that same non-entitled user, try navigating directly to the app's
   URL: confirm the app itself denies access (via its own
   `/api/access-check` integration from the "Before you start" checklist) —
   this confirms the security boundary is the app, not just the Shell's
   tile filtering.

## Removing or hiding an app later

- **Temporarily hide it from everyone** without losing any role
  assignments: clear its **Launch URL** in Workspace Tiles. Role
  assignments stay intact; re-adding the URL later restores the tile for
  everyone who already has access.
- **Revoke one user's access**: remove their role assignment in the Admin
  Console (Map User Security Access, or the equivalent role-management
  page). Their tile disappears next time they load the Workspace; the app
  itself also denies them via `/api/access-check`.
- **Fully decommission an app**: delete it from **Security** → this cascades
  to its roles, resources, and access grants (standard existing "Delete
  App" behavior, unchanged by this project).
