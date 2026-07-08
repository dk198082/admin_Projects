# Apps & Roles Security Setup

Role-based security administration for two internal apps ("Production Shop Floor", "Field Service Calendar"): a permission-matrix spreadsheet, a conceptual data model on canvas, and an Admin Console web app to manage users, roles, access grants, security policies, and an audit log.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

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
- `scripts/src/generate-roles-security-spreadsheet.ts` — permission-matrix Excel generator (`scripts/exports/apps-roles-security-setup.xlsx`)

## Architecture decisions

- Auth: Azure Entra ID (OIDC via openid-client v6, PKCE + state). Routes: `/api/auth/login`, `/callback`, `/me`, `/logout`. Sessions in Postgres (`session` table, connect-pg-simple, SESSION_SECRET). Signed-in users JIT-provisioned into `app_user` table.
- `requireAuth` (session check) protects all `/api` routes except `/api/healthz` and `/api/auth/*`. Session regenerated on login (fixation defense); redirect URI derived from first-hop forwarded headers with host validation.
- `/` is a public landing page when signed out ("Sign in with Microsoft"); dashboard when signed in.
- Required env: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`. Azure app registration must whitelist `https://<domain>/api/auth/callback` for each domain (dev + published).
- Clerk was used briefly then replaced by Entra ID; CLERK_* secrets may linger but are unused.

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
