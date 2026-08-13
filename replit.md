# Apps & Roles Security Setup

Role-based security administration for two internal apps ("Production Shop Floor", "Field Service Calendar"): a permission-matrix spreadsheet, a conceptual data model on canvas, and an Admin Console web app to manage users, roles, access grants, security policies, and an audit log.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (targets the same DB as runtime)
- DB: `AZURE_DATABASE_URL` secret (Azure PostgreSQL `d365crm`, schema `admin_console`) takes priority; falls back to Replit-managed `DATABASE_URL`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/admin-console` — React+Vite Admin Console frontend (preview path `/`)
- `artifacts/api-server/src/routes` — Express routes (users, roles, appsResources, grants, security, audit)
- `lib/api-spec/openapi.yaml` — API contract source of truth (regen via codegen)
- `lib/db/src/schema/` — Drizzle tables: apps, roles, users, roleAssignments, resources, accessGrants, securityPolicies, auditLog
- `scripts/src/verify-access-mapping-e2e.ts` — scripted e2e verification of Access Mapping flows (grant/update/remove/audit) via injected session; run `pnpm --filter @workspace/scripts run verify-access-mapping` with the API server running; cleans up after itself
- `scripts/src/generate-roles-security-spreadsheet.ts` — permission-matrix Excel generator, DB-driven (run `pnpm --filter @workspace/scripts run generate-spreadsheet`; output `scripts/exports/apps-roles-security-setup.xlsx`)

## Architecture decisions

- Auth: Azure Entra ID (OIDC via openid-client v6, PKCE + state). Routes: `/api/auth/login`, `/callback`, `/me`, `/logout`. Sessions in Postgres (`session` table, connect-pg-simple, SESSION_SECRET). Signed-in users JIT-provisioned into `app_user` table.
- `requireAuth` (session check) protects all `/api` routes except `/api/healthz` and `/api/auth/*`. Session regenerated on login (fixation defense); redirect URI derived from first-hop forwarded headers with host validation.
- `/` is a public landing page when signed out ("Sign in with Microsoft"); dashboard when signed in.
- Required env: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`. Azure app registration must whitelist `https://<domain>/api/auth/callback` for each domain (dev + published).
- Clerk was used briefly then replaced by Entra ID; CLERK_* secrets may linger but are unused.
- Database: Azure PostgreSQL (`fs-postgresql-prod.postgres.database.azure.com`, db `d365crm`, schema `admin_console`, verified TLS). `getDbPoolConfig()` in `lib/db/src/poolConfig.ts` parses `AZURE_DATABASE_URL` leniently (unencoded password chars) and sets `search_path=admin_console`; used by both the Drizzle pool and the session store pool. Data was migrated from the old Replit DB (public schema) on 2026-07-08.

## Product

- Admin Console: users (with Entra directory search + bulk import), roles, permission matrix, security policies, audit log (admin activity + Entra sign-ins), sync error log.
- App onboarding: Add App (auto-creates default security policy) + per-app Manage Resources (Tab/Form/Table) on the Permissions page. App rename syncs api_keys.app_name; app delete removes API keys + FK-cascades resources/grants/policy. Case-insensitive unique indexes: apps_name_lower_unique, resources_app_name_lower_unique (created in Azure PG + declared in Drizzle schema).
- User Access Mapping: auto-managed entitlement roles per app ("<App> - Read Only" → View, "<App> - Read / Write" → Read & Write; roles.app_id + is_entitlement, partial unique index roles_app_name_lower_unique). Auto-created on app create, renamed on app rename, grants synced on resource create; cascade-deleted with app. Access Mapping page: By User / By App views, multi-select New Assignment (users x apps x level, upserts one level per user+app), remove with confirm. Endpoints: GET /access-mapping, POST /access-mapping/assign (transactional), POST /access-mapping/remove.
- External access enforcement: `GET /api/access-check?entraObjectId=&app=` with `X-API-Key` header (key scoped to one app; sha256-hashed in `api_keys`). Apps call it at login; responds allowed/denied + roles + best permission level per resource. API keys managed on Security page (secret shown once).
- Work Order Purge page (`/work-order-purge`): search D365 F&O production orders in the `d365fo` staging mirror (same Azure DB), dry-run preview of per-table row counts, then transactional delete restricted to `dataareaid='TOUS'`. Module `artifacts/api-server/src/lib/purgeWorkOrder.ts` (imported from the production calendar project). Endpoints: GET /work-order-purge/search, POST /work-order-purge/preview, POST /work-order-purge/execute (audited; audit failure is non-blocking after commit). Only purge orders actually deleted in F&O — otherwise the next BYOD export re-inserts them.
- Sign-in log requires Entra ID P1 license (tenant currently lacks it; UI shows guidance).

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
