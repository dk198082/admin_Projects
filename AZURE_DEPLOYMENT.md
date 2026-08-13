# Deploying to Azure

This app already targets Azure in its architecture: Entra ID login via
`openid-client` (dynamic PKCE + state, redirect URI derived from request
headers — no hardcoded domain), and the database defaults to Azure PostgreSQL
(`AZURE_DATABASE_URL`, schema `admin_console`). The changes in this repo
(`Dockerfile`, `.dockerignore`, and the `STATIC_DIR` block in
`artifacts/api-server/src/app.ts`) make it deployable as a normal container —
no auth or DB code changes were needed.

## ⚠️ New in this export: login now requires an "Admin Console" entitlement — read this before your first deploy

Previously, anyone with a valid Entra ID login for the tenant could sign in
to the Admin Console — the app itself had no gate of its own beyond "is this
a real Microsoft account." **This export closes that gap**: `routes/auth.ts`
now checks, on every login, whether the authenticated user has an *active*
role assignment for an entitlement-type role scoped to an app literally named
`"Admin Console"` in this app's own `apps`/`roles`/`role_assignments` tables
— the same tables the console itself manages for every other app. If not,
the login is denied, logged (`ACCESS_DENIED` audit entry), and the user is
bounced back to the landing page with a clear "Access not granted" message.

**This creates a bootstrap problem on a brand-new database, and there's no
seed script for it in this export**: with an empty `admin_console` schema,
literally nobody can pass this check — including you — because granting
someone Admin Console access normally happens *through* the Admin Console
UI, which you can't reach yet. You must seed the very first entitlement by
hand, once, before anyone can log in for the first time.

**Prerequisite, easy to miss:** `lib/db/src/poolConfig.ts` connects with
`search_path=admin_console` (via `AZURE_DATABASE_URL`) but never creates that
schema — and I confirmed directly against a real Postgres instance that
`drizzle-kit push` (step 5 below) fails outright ("no schema has been
selected to create in") if the schema doesn't already exist. Create it
first, once, before your first `push`:

```sql
CREATE SCHEMA IF NOT EXISTS admin_console;
```

Then, after `drizzle-kit push` has created the tables, seed the first
entitlement — I ran this exact SQL against a real pushed schema to confirm
it produces a row `auth.ts`'s login-gate query actually matches:

```sql
-- Run once against a fresh database, after `drizzle-kit push` (step 5 below).
-- Replace the email/entraObjectId with your own — find your entraObjectId by
-- signing into https://portal.azure.com > Microsoft Entra ID > Users > (you)
-- > Object ID, or from an existing Entra ID token/claims dump.

INSERT INTO admin_console.apps (name) VALUES ('Admin Console')
  ON CONFLICT (name) DO NOTHING;

INSERT INTO admin_console.roles (name, description, app_id, is_entitlement)
  SELECT 'Admin Console Access', 'Grants login to the Admin Console itself', id, true
  FROM admin_console.apps WHERE name = 'Admin Console'
  ON CONFLICT DO NOTHING;

INSERT INTO admin_console.users (name, email, status, entra_object_id)
  VALUES ('Your Name', 'you@yourorg.com', 'active', '<your-entra-object-id>')
  ON CONFLICT (email) DO UPDATE SET entra_object_id = EXCLUDED.entra_object_id;

INSERT INTO admin_console.role_assignments (user_id, role_id)
  SELECT u.id, r.id
  FROM admin_console.users u, admin_console.roles r, admin_console.apps a
  WHERE u.email = 'you@yourorg.com'
    AND r.app_id = a.id AND a.name = 'Admin Console' AND r.is_entitlement = true
  ON CONFLICT DO NOTHING;

-- Verify: should return one row. If it returns zero, login will keep failing.
SELECT u.email, a.name AS app, r.name AS role
FROM admin_console.role_assignments ra
JOIN admin_console.users u ON u.id = ra.user_id
JOIN admin_console.roles r ON r.id = ra.role_id
JOIN admin_console.apps a ON a.id = r.app_id
WHERE u.email = 'you@yourorg.com';
```

Once you can log in, grant everyone else's Admin Console access (and every
other app's access) through the UI as normal — this manual step is only
needed once, for the very first account, on a database that's never had
anyone log in before.

**Verifying this actually works once deployed:** this export also adds
`scripts/smoke-test-public-api.sh`, a black-box smoke test against the live
API (health check, and `/access-check` returning the right status for
missing/invalid/valid API keys). Run it against your Azure URL after
deploying:
```bash
bash scripts/smoke-test-public-api.sh https://<your-app>.azurewebsites.net/api
```

## Recommended shape: one container, one Azure resource

`Dockerfile` at the repo root builds the API server **and** the
`admin-console` frontend, and the API server serves the built frontend itself
(`STATIC_DIR` env var — see `app.ts`). That means:

- One Azure resource to run (Web App for Containers **or** Container Apps).
- The existing `cors({ origin: true, credentials: true })` in `app.ts`
  reflects any origin already, so nothing to configure there — same-origin
  deployment just means the browser never makes a cross-origin request in the
  first place.
- The session cookie stays `sameSite: "lax"` with no changes needed.

## 1. Azure resources to create

| Resource | Purpose |
|---|---|
| Azure Container Registry (ACR) | Stores the built image (or use `az webapp up` / GitHub Actions to build+push in one step) |
| Azure App Service (Linux, "Web App for Containers") **or** Azure Container Apps | Runs the container |
| Azure Database for PostgreSQL – Flexible Server | Database `d365crm`, schema `admin_console` (per `replit.md`) — reuse the existing one if this is joining the same tenant as the Field Service Calendar app, or provision a fresh instance |
| Azure App Registration (Entra ID) | Login (`AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET`) |

## 2. Build & push the image

```bash
az acr login --name <your-acr-name>
docker build -t <your-acr-name>.azurecr.io/data-admin-suite:latest .
docker push <your-acr-name>.azurecr.io/data-admin-suite:latest
```

Then point an App Service (Web App for Containers) or Container App at that
image. The container listens on `$PORT`, which Azure App Service sets to
`8080` for custom containers; Container Apps lets you declare the target port
explicitly.

## 3. Environment variables (App Settings / Container Apps secrets)

| Variable | Required | Notes |
|---|---|---|
| `AZURE_DATABASE_URL` | Yes (or `DATABASE_URL`) | `postgres://user:password@host/dbname` — parsed leniently (unencoded password characters allowed), forces `search_path=admin_console` (override with `AZURE_PG_SCHEMA`), TLS with full certificate verification. Falls back to `DATABASE_URL` if unset (no schema override in that path). |
| `SESSION_SECRET` | Yes | Long random string; server refuses to boot without it |
| `AZURE_TENANT_ID` | Yes | From the Azure App Registration |
| `AZURE_CLIENT_ID` | Yes | From the Azure App Registration |
| `AZURE_CLIENT_SECRET` | Yes | From the Azure App Registration ("Certificates & secrets") |
| `PORT` | No | Azure sets this for you; the `Dockerfile` defaults it to `8080` |
| `STATIC_DIR` | No | Already set by the `Dockerfile`; only change if you rearrange the image |

Nothing else is required — unlike a from-scratch setup, this app derives its
OAuth redirect URI at request time (`getRedirectUri` in `lib/oidc.ts`) from
`X-Forwarded-Host`/`X-Forwarded-Proto`, and creates its own `session` table on
boot (`ensureSessionTable()` in `app.ts`, awaited before the server starts
listening) — no manual SQL step needed for a fresh database.

## 4. Register the callback URL in Entra ID

In the Azure App Registration → **Authentication**, add a Web platform
redirect URI for **every** domain the app will be reached at (dev, staging,
and the production Azure domain), each as `https://<domain>/api/auth/callback`.
`getRedirectUri()` builds this from the incoming request's host, so a mismatch
here (not in app code) is what breaks login after moving domains.

## 5. Push the Drizzle schema

From a machine with `AZURE_DATABASE_URL` (or `DATABASE_URL`) pointed at the
target database:

```bash
pnpm --filter @workspace/db run push
```

This creates `apps`, `roles`, `users`, `roleAssignments`, `resources`,
`accessGrants`, `securityPolicies`, `auditLog`, etc. under the `admin_console`
schema. The two case-insensitive unique indexes mentioned in `replit.md`
(`apps_name_lower_unique`, `resources_app_name_lower_unique`) are declared in
the Drizzle schema, so `push` creates them too.

## 6. Health check

`GET /api/healthz` returns `{ "status": "ok" }` and does not require
authentication — point Azure App Service's health check path (or Container
Apps' liveness probe) at `/api/healthz`.

## Notes / things to double-check after first deploy

- **Sign-in log**: per `replit.md`, this requires an Entra ID P1 license; if
  the target tenant lacks it, the UI already shows guidance rather than
  failing — no action needed unless you want the feature to actually work.
- **External `/api/access-check` consumers**: if other apps (e.g. the Field
  Service Calendar app) call this Admin Console's `access-check` endpoint with
  an `X-API-Key`, update their configured base URL to the new Azure domain
  once this app is live.
- **`CLERK_*` secrets**: per `replit.md` these are leftover from a
  since-replaced auth provider and are unused — safe to leave unset in Azure.
- **New in this export: Work Order Purge** (`/api/work-order-purge/*`, UI at
  `WorkOrderPurge.tsx`) — deletes stale rows for deleted D365 F&O production
  orders from the `d365fo` schema. No new environment variables: it reuses
  this app's existing `DATABASE_URL`/`AZURE_DATABASE_URL` connection (via
  `@workspace/db`), not a separate credential. It's mounted after
  `requireAuth` in `routes/index.ts` like every other admin route, so it's
  already protected the same way the rest of the console is — nothing extra
  to lock down here, unlike the standalone CLI version of this same feature
  that ships separately with the Production Calendar app.
- **Regression found and fixed:** 3 test files (`apiKeys.test.ts`,
  `apiKeys.auth-enforcement.test.ts`, `requireAuth.integration.test.ts`) had
  reverted to a broken session-mocking pattern I'd fixed in an earlier round
  — `req.session.user = {...}` on a request with no real session middleware
  attached, which throws (`req.session` is `undefined`) since nothing ever
  initializes it in these minimal test apps. The failure was hard to spot:
  it surfaced as generic `500`s with no error logged anywhere, because the
  test apps don't include the real error-handling middleware from `app.ts`.
  I only found the real cause by temporarily instrumenting a debug error
  handler into a scratch copy of the test file. Fixed by restoring the safe
  `(req as unknown as {...}).session = {...}` pattern in all three files —
  confirmed with a full rebuild and test run: 65/65 passing (was 55/65).
