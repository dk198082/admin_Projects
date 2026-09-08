# Digital Workspace — Functional Requirements Document

**Status:** Implemented (this document describes what was actually built —
see `TECHNICAL_DESIGN.md` for how, `WORKFLOWS.md` for the same information
as process diagrams plus how this maps against the reference architecture
picture, and `ADDING_NEW_APPS.md` for the ongoing operating procedure).

## 1. Purpose

Give every user **one place to sign in** and see **only the business
applications they're entitled to**, and let them **open any of those
applications without signing in again**. This mirrors the target
architecture: a Digital Workspace Shell (portal) on top of a set of
independent business applications, backed by a shared identity and
entitlement layer.

## 2. Scope

### In scope
- A new **Workspace Shell** — the landing experience after sign-in, showing
  app tiles grouped by category.
- **Entitlement-driven visibility** — a user only sees a tile for an app if
  an administrator has granted them a role for that app.
- **Single sign-on** — signing in once (to the Shell or to any app directly)
  means every other app in the workspace can be opened without a second
  login prompt.
- Bringing the **existing three applications** into the workspace as the
  initial app set:
  - Field Service Calendar
  - Production Calendar
  - Admin Console (now itself one of the launchable tiles — "Admin /
    Configuration" in the reference architecture — rather than a separate
    front door)
- A **documented, repeatable process** for onboarding future applications
  into the workspace with no shell code changes required.

### Out of scope (for this phase)
- A unified design system / shared component library across all apps (each
  app keeps its own UI stack — see "Independent by design" in
  `TECHNICAL_DESIGN.md`).
- An API Gateway product (Azure API Management, etc.) in front of the
  satellite apps. Each app still exposes its own API directly; adding a
  gateway is a future, additive step and doesn't change anything described
  here.
- Deep-linking from the Shell into a specific screen inside a satellite app
  (tiles link to each app's own home page).
- Mobile native apps (the Shell and every app are responsive web apps).

## 3. Actors

| Actor | Description |
|---|---|
| **End user** | Signs into the workspace with their organizational Microsoft account. Sees and opens only the apps they've been granted access to. |
| **Administrator** | Uses the Admin Console to onboard apps, create users, assign roles, and configure each app's Workspace tile (launch URL, icon, category, description). |
| **Satellite application** | Any of the independent business applications (Field Service Calendar, Production Calendar, and future apps). Each enforces its own access control independently of the Shell. |

## 4. Functional Requirements

### FR-1 — Single sign-on
1.1. A user signs in once, with their Microsoft Entra ID account, via the
     Workspace Shell.
1.2. Opening any application the user is entitled to must **not** present a
     second username/password or MFA challenge, provided the user's Entra ID
     browser session is still valid (see NFR-2 for the underlying mechanism
     and its limits).
1.3. Signing out of the Workspace Shell does not, on its own, sign the user
     out of every satellite application (each has its own session — see
     `TECHNICAL_DESIGN.md`, "What single sign-on does and doesn't cover").

### FR-2 — Entitlement-aware app visibility
2.1. The Workspace Shell shows a tile for an application if and only if the
     signed-in user holds at least one role assignment for that application.
2.2. An application with no role assignment for the user is not shown, not
     grayed out, not hinted at — it's simply absent.
2.3. An application that has been onboarded (exists in the system) but has
     no launch URL configured yet is never shown as a tile to anyone,
     regardless of role assignments — this makes onboarding safe to do in
     steps (see `ADDING_NEW_APPS.md`).
2.4. Tiles are grouped by category (e.g. "Field Operations",
     "Administration") and are searchable by name.

### FR-3 — Defense in depth (the Shell is not the security boundary)
3.1. Hiding a tile in the Shell is a convenience, not an access control
     mechanism. Every satellite application must independently verify the
     user's entitlement (via the existing `/api/access-check` integration
     each app already has) before granting access — a user who navigates
     directly to an app's URL without ever seeing its tile must still be
     correctly allowed or denied by that app itself.

### FR-4 — Centralized administration
4.1. Administrators manage which users exist, which roles exist per app,
     and who holds which role, from the existing Admin Console — no new
     admin tool was introduced.
4.2. Administrators configure an app's Workspace presentation (launch URL,
     icon, category, description) from a new "Workspace Tiles" section on
     the Admin Console's Security page.
4.3. Every administrative action (creating a user, assigning a role, editing
     a tile) is recorded in the existing audit log.

### FR-5 — Extensibility
5.1. Adding a new application to the workspace must require **no changes to
     the Shell's code** — only data (an `apps` row, its roles, and its
     tile settings) and, separately, deploying the new application itself.
     See `ADDING_NEW_APPS.md` for the full procedure.

## 5. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-1 | The Shell and every satellite app are deployed as independent Azure resources (or, optionally, share a single Azure resource with the Admin Console — see `TECHNICAL_DESIGN.md`) so that a deployment or outage in one app cannot take down another. |
| NFR-2 | Single sign-on is achieved via **Microsoft Entra ID's own tenant-wide SSO session** in the browser, not a custom shared-session mechanism — see `TECHNICAL_DESIGN.md`, "Single sign-on design", for exactly how and why this works and what it depends on (same tenant, admin-consented app registrations). |
| NFR-3 | The Shell must degrade gracefully: if the entitlement lookup fails, show a clear error rather than a blank page; if a user has zero entitlements, show a clear "no apps yet" state rather than an empty, unexplained page. |
| NFR-4 | All authentication is scoped to the organization's Microsoft Entra ID tenant — no separate username/password system is introduced anywhere in the workspace. |
| NFR-5 | The system must be deployable to Azure using the same patterns already established for every app in this workspace (Docker container, Azure Postgres, Azure App Service or Container Apps) — see `TECHNICAL_DESIGN.md` §7. |

## 6. User Journeys

### 6.1 First-time sign-in
1. User navigates to the workspace URL.
2. Sees the Shell's landing page and clicks **Sign in with Microsoft**.
3. Completes Microsoft's own sign-in (and MFA, if required by the tenant's
   policy) — this is the *only* time in the session the user provides
   credentials.
4. Lands on the Workspace, sees tiles for every app they're entitled to.

### 6.2 Opening an app
1. User clicks a tile (e.g. "Field Service Calendar").
2. Browser navigates to that app's own URL.
3. That app's frontend detects it has no local session and redirects to its
   own `/api/auth/login`.
4. Entra ID recognizes the existing tenant-wide SSO session and returns
   immediately, without prompting the user.
5. The app establishes its own session and shows its own home page.
6. **From the user's point of view, steps 3–5 are a brief redirect, not a
   login screen.**

### 6.3 A user with no access yet
1. User signs into the Shell successfully (their Microsoft account is valid
   for the tenant).
2. Sees an empty state: "No applications yet — contact an administrator."
3. Administrator assigns them a role for an app in the Admin Console.
4. User refreshes (or signs in again later) and now sees that app's tile.

### 6.4 Onboarding a new application (administrator)
See `ADDING_NEW_APPS.md` for the complete, step-by-step procedure. In
summary: register the app in Entra ID → deploy the app → add it in the Admin
Console → assign roles → set its Workspace tile → done, no Shell changes.

## 7. Success Criteria

- A user with access to 2 of 3 workspace apps sees exactly 2 tiles.
- Clicking a tile never shows a visible login form for a user with an
  active Entra ID browser session.
- An app with no `launchUrl` set never appears as a tile.
- Revoking a user's role for an app removes its tile the next time they load
  the Shell — without requiring any change to that app itself.
- A new application can be added to the workspace by an administrator, using
  only the existing Admin Console UI, with zero code changes to the Shell.
