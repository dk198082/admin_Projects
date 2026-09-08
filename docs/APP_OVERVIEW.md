# Admin Console — App Functionality & Data Flow

> **Audience:** Engineers and power-users who need to understand what the Admin Console does, how data moves through it, and how security decisions are made — without reading the source code.

> **⚠️ Keeping this document in sync**
>
> This document was written from a source code review and is **not auto-generated**. It must be updated manually whenever the following files change:
>
> | Changed file(s) | Section(s) to update |
> |---|---|
> | `artifacts/api-server/src/routes/index.ts` | §2.4 Auth middleware — auth guard boundary |
> | `artifacts/api-server/src/routes/auth.ts` | §2 Authentication & Session Lifecycle |
> | `artifacts/api-server/src/routes/accessCheck.ts` | §4.3 How `/access-check` evaluates a request |
> | `artifacts/api-server/src/routes/users.ts` | §6 Users |
> | `artifacts/api-server/src/routes/accessMapping.ts` | §7 Map User Security Access |
> | `artifacts/api-server/src/routes/appsResources.ts` | §8.1 Apps, §8.2 Resources |
> | `artifacts/api-server/src/routes/roles.ts` | §8.3 Roles |
> | `artifacts/api-server/src/routes/grants.ts` | §8.4 Access Grants |
> | `artifacts/api-server/src/routes/security.ts` | §9 Security Policies |
> | `artifacts/api-server/src/routes/audit.ts` | §10 Audit Log |
> | `artifacts/api-server/src/routes/sync.ts` | §11 Data Sync Error Log |
> | `artifacts/api-server/src/routes/workOrderPurge.ts` | §12 Work Order Purge |
> | `artifacts/api-server/src/routes/apiKeys.ts` | §13 API Key Authentication |
> | `artifacts/api-server/src/routes/permissionMatrix.ts` | §14 Permission Matrix Export |
> | `lib/db/src/schema/*.ts` | §3 Data Model (Mermaid ERD) + relevant feature section |
>
> Run `bash scripts/check-overview-drift.sh` (or the `docs-drift` validation step) to catch obvious drift before merging. See `CONTRIBUTING.md` for full contributor guidance.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Authentication & Session Lifecycle](#2-authentication--session-lifecycle)
3. [Data Model (Mermaid ERD)](#3-data-model-mermaid-erd)
4. [Access Model Explained](#4-access-model-explained)
5. [Dashboard](#5-dashboard)
6. [Users](#6-users)
7. [Map User Security Access](#7-map-user-security-access)
8. [Permissions (Roles, Resources & Access Grants)](#8-permissions-roles-resources--access-grants)
9. [Security Policies](#9-security-policies)
10. [Audit Log](#10-audit-log)
11. [Data Sync Error Log](#11-data-sync-error-log)
12. [Work Order Purge](#12-work-order-purge)
13. [API Key Authentication (External Callers)](#13-api-key-authentication-external-callers)
14. [Permission Matrix Export](#14-permission-matrix-export)

---

## 1. Overview

The Admin Console is a web-based management portal backed by a REST API. It governs:

- Which **users** exist in the system and whether they are active or disabled.
- Which **applications** and **resources** are registered.
- Which **roles** those users hold, and what **access grants** those roles carry.
- A simplified "entitlement" assignment surface (**Map User Security Access**) that lets operators set a user's access level for an app without needing to understand the underlying role/grant model.
- **Security policies** attached to each registered app.
- A tamper-evident **audit log** of every administrative action.
- A read-only view of **D365 / Dataverse sync errors** surfaced from an external sync schema.
- A safe **work-order purge** tool that removes stale production-order rows from a D365 BYOD staging mirror.

### Technology stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite, Wouter routing, TanStack Query |
| API server | Node.js + Express, TypeScript |
| Database ORM | Drizzle ORM (PostgreSQL) |
| Auth | Microsoft Entra ID (Azure AD) OIDC + PKCE via `openid-client` |
| Session store | `express-session` backed by PostgreSQL (`connect-pg-simple`) |
| External directory | Microsoft Graph API (user search, sign-in logs) |

---

## 2. Authentication & Session Lifecycle

### 2.1 Sign-in flow (OIDC Authorization Code + PKCE)

```
Browser                  Admin Console API              Entra ID (login.microsoftonline.com)
  |                            |                                      |
  |-- GET /api/auth/login ----->|                                      |
  |                            | generate codeVerifier + state        |
  |                            | store both in session                |
  |                            |-- redirect to Entra /authorize ----->|
  |<-- HTTP 302 (to Entra) ----|                                      |
  |                            |                              user logs in, consents
  |<-- redirect to /api/auth/callback?code=...&state=... ------------|
  |-- GET /api/auth/callback -->|                                      |
  |                            | verify state, exchange code          |
  |                            | using codeVerifier (PKCE S256)       |
  |                            |-- POST /token ----------------------->|
  |                            |<-- id_token + access_token ----------|
  |                            | extract: oid/sub → entraObjectId     |
  |                            |          email, name                 |
  |                            | UPSERT app_user (on conflict         |
  |                            |   update email, name, lastLoginAt)   |
  |                            | session.regenerate() ← anti-fixation |
  |                            | session.user = { id, entraObjectId,  |
  |                            |   email, name }                      |
  |                            | logAudit("login", "Session", ...)    |
  |<-- HTTP 302 → /  ----------|                                      |
```

**Key points:**
- The `codeVerifier` and `state` are stored in the session before the redirect and consumed exactly once in the callback.
- Session is **regenerated** (new session ID) after successful login to prevent session-fixation attacks.
- The `app_user` table tracks Admin Console operators (people who log into the console). The `users` table tracks managed users (the subjects of access control).
- OIDC discovery is cached for the process lifetime; the `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, and `AZURE_CLIENT_SECRET` environment variables must be set.

### 2.2 Session user object

After login, every authenticated request carries:

```jsonc
req.session.user = {
  id: number,           // app_user.id (PK in admin_console schema)
  entraObjectId: string,
  email: string,
  name: string
}
```

The frontend queries `GET /api/auth/me` (returns 401 if unauthenticated) to decide whether to show the application or the landing/login page.

### 2.3 Sign-out

`POST /api/auth/logout` — destroys the session and logs an audit entry. `GET /api/auth/logout` — destroys the session and redirects to `/` (used for link-based logout fallback).

### 2.4 Auth middleware

All routes after the `/auth/*` and `/access-check` blocks in `routes/index.ts` are wrapped by `requireAuth` middleware, which returns `401` if `req.session.user` is absent. The `/access-check` endpoint is deliberately **outside** this guard because external callers authenticate via API key, not a session.

---

## 3. Data Model (Mermaid ERD)

All tables live in the `admin_console` schema unless otherwise noted.

```mermaid
erDiagram
    app_user {
        int id PK
        text entra_object_id UK
        text email
        text name
        timestamp last_login_at
        timestamp created_at
    }

    apps {
        int id PK
        text name UK
    }

    resources {
        int id PK
        int app_id FK
        text name
        text type
        text description
    }

    roles {
        int id PK
        text name UK
        text description
        int app_id FK "nullable; ties to apps"
        boolean is_entitlement
    }

    users {
        int id PK
        text name
        text email UK
        text status "active | disabled"
        text entra_object_id UK "nullable"
        timestamp created_at
    }

    role_assignments {
        int id PK
        int user_id FK
        int role_id FK
        timestamp created_at
    }

    access_grants {
        int id PK
        int role_id FK
        int resource_id FK
        text level "view | read & write | full rights"
    }

    security_policies {
        int id PK
        int app_id FK UK
        text auth_method
        text mfa_required
        int session_timeout_minutes
        text record_level_scope
        text field_level_rules
        boolean audit_logging
        text data_export_policy
    }

    audit_log {
        int id PK
        text action
        text entity
        text detail
        text actor
        timestamp created_at
    }

    api_keys {
        int id PK
        text app_name "denormalized, not FK"
        text label
        text key_hash UK "SHA-256 of raw key"
        text key_prefix "first 10 chars, shown in UI"
        timestamp created_at
        timestamp revoked_at "nullable"
        timestamp last_used_at "nullable"
    }

    apps ||--o{ resources : "has"
    apps ||--o| security_policies : "has one"
    apps ||--o{ roles : "owns (entitlement roles)"
    resources ||--o{ access_grants : "subject of"
    roles ||--o{ access_grants : "holds"
    roles ||--o{ role_assignments : "assigned via"
    users ||--o{ role_assignments : "has"
```

> **Note:** `app_user` (Admin Console operators) and `users` (managed users) are separate tables and have no foreign-key relationship to each other. The `d365fo` schema (staging tables for the Work Order Purge feature) and the `sync.error_log` table (Data Sync Error Log) live in separate schemas and are not part of the Drizzle schema — they are accessed via raw SQL.

---

## 4. Access Model Explained

The access control model has six entities and two evaluation paths.

### 4.1 Entity chain

```
App ──(has)──► Resource ──(subject of)──► Access Grant ──(held by)──► Role
                                                                        │
User ──(assigned via)──► Role Assignment ──────────────────────────────┘
```

| Entity | Purpose |
|---|---|
| **App** | A registered application (e.g. "Field Service", "Finance"). |
| **Resource** | A named capability within an app (e.g. "Work Orders", "Invoices"). Has a `type` (e.g. `page`, `feature`, `report`). |
| **Role** | A named collection of permissions. Roles with `is_entitlement = true` are auto-managed by the system. |
| **Access Grant** | Links a Role to a Resource at a specific level (`view`, `read & write`, `full rights`). A role can only have one grant per resource (unique constraint). |
| **User** | A managed user. Can be `active` or `disabled`. May have an `entra_object_id` linking to Azure AD. |
| **Role Assignment** | Links a User to a Role. Each (user, role) pair is unique. |

### 4.2 Entitlement roles (auto-managed)

When an App is created, two **entitlement roles** are automatically created:
- `<AppName> - Read Only` — grants `View` level on all of the app's resources.
- `<AppName> - Read / Write` — grants `Read & Write` level on all of the app's resources.

When a new **Resource** is added to an app, the `grantEntitlementsForResource` function automatically adds the appropriate `access_grants` rows to both entitlement roles.

When an **App is renamed**, entitlement role names are updated in a transaction along with any `api_keys.app_name` references.

### 4.3 How `/access-check` evaluates a request

External callers (downstream applications) query `GET /access-check` with an API key and two query parameters: `entraObjectId` and `app`.

Evaluation steps:
1. Validate the `X-API-Key` header; look up the SHA-256 hash in `api_keys` and verify `revoked_at IS NULL`.
2. Confirm the API key's `app_name` matches the `app` query parameter (case-insensitive). A key scoped to "Field Service" cannot query access for "Finance".
3. Look up the `users` row by `entra_object_id`.
4. If user not found → `allowed: false, reason: "User is not registered"`.
5. If user `status != "active"` → `allowed: false, reason: "User is disabled"`.
6. Fetch all `role_assignments` for the user → join to `roles`.
7. If no roles → `allowed: false, reason: "User has no roles assigned"`.
8. Fetch all `access_grants` for those roles, filtered to the named app → join to `resources` and `apps`.
9. If no matching grants → `allowed: false, reason: "User has no permissions for app"`.
10. De-duplicate by resource, keeping the highest-privilege level (`view` < `read & write` < `full rights`).
11. Return `allowed: true` with the user's roles and effective per-resource permissions.
12. Side-effect: stamp `api_keys.last_used_at` on every successful (authenticated) call.

---

## 5. Dashboard

**Route:** `/`  
**API endpoint:** `GET /api/summary`

The Dashboard shows a live count of every major entity in the system. It aggregates eight parallel queries in a single API call.

### Data flow — load Dashboard

| Step | Action | Table read |
|---|---|---|
| 1 | React mounts, TanStack Query fires `GET /api/summary` | — |
| 2 | Server counts users, active users, roles, apps, resources, grants, role assignments, audit entries | `users`, `roles`, `apps`, `resources`, `access_grants`, `role_assignments`, `audit_log` |
| 3 | Returns `{ users, activeUsers, roles, apps, resources, grants, assignments, auditEntries }` | — |

No writes. No side-effects.

---

## 6. Users

**Route:** `/users`  
**API prefix:** `/api/users`, `/api/role-assignments`

The Users page lists every managed user with their assigned roles. Operators can create, edit, and delete users individually or in bulk.

### 6.1 List users

`GET /api/users` — reads `users` joined with `role_assignments` → `roles`. Returns users ordered by name, each with an embedded `roles[]` array.

### 6.2 Create user

`POST /api/users`

| Step | Action | Table written |
|---|---|---|
| 1 | Validate body (name, email, status, optional entraObjectId, optional roleIds) | — |
| 2 | Check email uniqueness | `users` (read) |
| 3 | If entraObjectId provided, check it is not already used | `users` (read) |
| 4 | Insert user | `users` (insert) |
| 5 | If roleIds provided, validate they exist, then insert assignments | `roles` (read), `role_assignments` (insert) |
| 6 | Write audit entries: one per role assignment + one for user creation | `audit_log` (insert) |
| 7 | Return full user object with roles | `users`, `role_assignments`, `roles` (read) |

### 6.3 Bulk import from Entra

`POST /api/users/bulk-import`

Accepts an array of user objects and an optional `roleIds` array. Runs inside a **single database transaction**:

| Step | Action | Table written |
|---|---|---|
| 1 | Validate roleIds (if any) | `roles` (read) |
| 2 | Load existing emails + entraObjectIds for duplicate detection | `users` (read) |
| 3 | For each user: skip if email or entraObjectId already exists, else insert | `users` (insert, onConflictDoNothing) |
| 4 | If roleIds provided, insert role assignments for each newly created user | `role_assignments` (insert, onConflictDoNothing) |
| 5 | Write single bulk audit entry (lists names of created users) | `audit_log` (insert) |
| 6 | Return `{ created, skipped, assignedRoles }` | — |

The UI supports searching the **Entra directory** (`GET /api/entra/users?query=…`) via Microsoft Graph to look up users to import. This requires the service principal to have the `User.Read.All` Graph permission.

### 6.4 Update user

`PATCH /api/users/:id`

Updates `name`, `email`, `status`, and/or `entraObjectId`. Empty string for `entraObjectId` is stripped (kept unchanged). Writes one audit entry to `audit_log`.

### 6.5 Delete user (single)

`DELETE /api/users/:id`

Hard-deletes from `users`. Cascades via FK to `role_assignments`. Writes one audit entry.

### 6.6 Bulk delete users

`POST /api/users/bulk-delete`

Accepts `{ userIds: number[] }`. Deletes all matching rows from `users` in a single statement. FK cascade removes their `role_assignments`. Writes one audit entry listing deleted names.

### 6.7 Role assignment management (from Users page)

`POST /api/role-assignments` — assign one role to one user. Writes audit entry.  
`DELETE /api/role-assignments/:id` — remove a single role assignment. Writes audit entry.  
`POST /api/role-assignments/bulk` — assign N roles to M users in all combinations. Writes one audit entry.

---

## 7. Map User Security Access

**Route:** `/access-mapping`  
**API prefix:** `/api/access-mapping`

This page provides a simplified, app-level view of entitlement assignments. Instead of working with roles directly, operators select users, select apps, and choose an access level ("Read Only" or "Read / Write"). The system handles all role and grant bookkeeping automatically.

### 7.1 What "access mapping" means

The access mapping layer only operates on **entitlement roles** (`roles.is_entitlement = true`). These roles are named `<AppName> - Read Only` and `<AppName> - Read / Write` and are auto-created when an app is onboarded.

### 7.2 List access mappings

`GET /api/access-mapping`

Joins `role_assignments` → `roles` (where `is_entitlement = true`) → `users` → `apps`. Returns one row per (user, app) with the derived entitlement level.

### 7.3 Assign access

`POST /api/access-mapping/assign`

Body: `{ userIds: number[], appIds: number[], level: "Read Only" | "Read / Write" }`

| Step | Action | Tables written |
|---|---|---|
| 1 | Validate users and apps exist | `users`, `apps` (read) |
| 2 | For each app: call `ensureEntitlementsForApp` to guarantee the two entitlement roles exist | `roles`, `access_grants` (upsert) |
| 3 | Find the target entitlement role matching the requested level | `roles` (read) |
| 4 | For each user: delete any existing assignments to the *other* entitlement roles for this app (level change) | `role_assignments` (delete) |
| 5 | Insert new assignment to the target role (if not already present) | `role_assignments` (insert) |
| 6 | Count: `assigned` (new), `updated` (level changed), `skipped` (already at target level) | — |
| 7 | Write one audit entry | `audit_log` (insert) |

### 7.4 Remove access

`POST /api/access-mapping/remove`

Body: `{ userIds: number[], appIds: number[] }`

Removes all entitlement role assignments (both levels) for the given users × apps combination. Writes one audit entry.

---

## 8. Permissions APIs (No Dedicated Page)

**Admin Console route:** No dedicated page; the former `/permissions` page has been removed.
**API prefix:** `/api/apps`, `/api/resources`, `/api/roles`, `/api/access-grants`

These endpoints remain available to support the entitlement and access-check model. Application
onboarding is available from the **Security Policies** page.

### 8.1 Apps

| Endpoint | Action | Side-effects |
|---|---|---|
| `GET /api/apps` | List all apps with resource count | — |
| `POST /api/apps` | Create app | Inserts `apps` row, creates a default `security_policies` row, creates two entitlement roles (`<Name> - Read Only`, `<Name> - Read / Write`) in `roles`. Audit entry. |
| `PATCH /api/apps/:id` | Rename app | Updates `apps`, renames entitlement roles in `roles`, updates `api_keys.app_name` for any keys scoped to this app. Audit entry. |
| `DELETE /api/apps/:id` | Delete app | Deletes `api_keys` by `app_name`, then deletes `apps` row. FK cascade deletes `resources`, `access_grants`, `security_policies`, and all `roles` attached to the app. Audit entry. |

### 8.2 Resources

| Endpoint | Action | Side-effects |
|---|---|---|
| `GET /api/resources` | List resources (filterable by `?appId=`) | — |
| `POST /api/resources` | Create resource | Inserts `resources` row. Calls `grantEntitlementsForResource` — automatically inserts `access_grants` rows for both entitlement roles. Audit entry. |
| `PATCH /api/resources/:id` | Update name/type/description | Audit entry. |
| `DELETE /api/resources/:id` | Delete resource | FK cascade removes its `access_grants`. Audit entry. |

### 8.3 Roles

| Endpoint | Action | Side-effects |
|---|---|---|
| `GET /api/roles` | List all roles with userCount and grantCount | — |
| `POST /api/roles` | Create a manual role | Inserts `roles` row (appId = null, isEntitlement = false). Audit entry. |

### 8.4 Access Grants

| Endpoint | Action | Side-effects |
|---|---|---|
| `GET /api/access-grants` | List grants (filterable by `?appId=` and `?roleId=`) | — |
| `POST /api/access-grants` | Create grant | Inserts `access_grants`. Unique constraint prevents duplicate (role, resource) pairs. Audit entry. |
| `PATCH /api/access-grants/:id` | Change grant level | Updates `access_grants.level`. Audit entry. |
| `DELETE /api/access-grants/:id` | Revoke grant | Deletes `access_grants` row. Audit entry. |

### 8.5 Permission matrix export

`GET /api/permission-matrix/export`

Generates an Excel (.xlsx) workbook via `@workspace/permission-matrix` that cross-references all roles × resources with their grant levels. Returned as a binary download; no database writes.

---

## 9. Security Policies

**Route:** `/security`  
**API prefix:** `/api/security-policies`

Operators can onboard an application using **Add App** on this page. A security policy and the
default Read Only / Read / Write entitlement roles are created automatically. Operators can then
edit the policy fields to document (and enforce at the application layer) the security configuration
for that app.

### Policy fields

| Field | Type | Description |
|---|---|---|
| `authMethod` | text | Authentication method (default: `"SSO (Entra ID)"`) |
| `mfaRequired` | text | MFA requirement description (default: `"All users"`) |
| `sessionTimeoutMinutes` | integer | Session idle timeout in minutes (default: 30) |
| `recordLevelScope` | text | Freeform description of record-level filtering |
| `fieldLevelRules` | text | Freeform description of field-level restrictions |
| `auditLogging` | boolean | Whether audit logging is enabled (default: true) |
| `dataExportPolicy` | text | Freeform description of data export controls |

### Data flow — update policy

`PATCH /api/security-policies/:id`

| Step | Action | Table written |
|---|---|---|
| 1 | Validate body (any subset of policy fields) | — |
| 2 | Update `security_policies` row | `security_policies` (update) |
| 3 | Re-fetch with joined `appName` | `security_policies`, `apps` (read) |
| 4 | Write audit entry: `Updated security policy for <AppName>` | `audit_log` (insert) |
| 5 | Return updated policy | — |

---

## 10. Audit Log

**Route:** `/audit`  
**API prefix:** `/api/audit-log`

The audit log is an append-only record of every administrative action. Every mutation route in the API writes at least one entry via the `logAudit(action, entity, detail, actor)` helper.

### Audit entry fields

| Field | Description |
|---|---|
| `action` | Verb: `login`, `logout`, `create`, `update`, `delete`, `assign`, `revoke`, `grant`, `purge` |
| `entity` | Noun: `Session`, `User`, `Role`, `App`, `Resource`, `Permission`, `Security Policy`, `API Key`, `Access Mapping`, `Work Order` |
| `detail` | Human-readable description of what changed |
| `actor` | The `name` from `req.session.user`, or `"System Administrator"` if unavailable |
| `createdAt` | Server timestamp (with timezone) |

### Data flow — load Audit Log

`GET /api/audit-log?limit=N` — returns up to N entries (default 50, maximum configurable) ordered by `createdAt DESC, id DESC`. No writes.

### What generates audit entries (summary)

| Action | Audit entry written by |
|---|---|
| Sign in / sign out | `auth.ts` |
| Create / update / delete user | `users.ts` |
| Bulk import / bulk delete users | `users.ts` |
| Assign / revoke role | `roles.ts`, `users.ts` |
| Create app / rename app / delete app | `appsResources.ts` |
| Create / update / delete resource | `appsResources.ts` |
| Grant / update / revoke access grant | `grants.ts` |
| Assign / remove access mapping | `accessMapping.ts` |
| Update security policy | `security.ts` |
| Create / revoke API key | `apiKeys.ts` |
| Execute work order purge | `workOrderPurge.ts` |

---

## 11. Data Sync Error Log

**Route:** `/sync-errors`  
**API prefix:** `/api/sync/error-log`, `/api/sync/entities`

This page provides a read-only view of Dynamics 365 / Dataverse integration sync errors stored in a separate `sync.error_log` table in the same PostgreSQL instance. It only shows errors from today and yesterday; older entries are excluded. Opportunity, quote, quotedetails, and salesorderssalesorderdetails entities are excluded, as are messages containing "connection error". The Admin Console does not own or write to this table — it only reads it.

### Data flow — load Sync Errors

`GET /api/sync/error-log?limit=N&search=...&entity=...`

| Step | Action |
|---|---|
| 1 | Restricts results to `created_on >= CURRENT_DATE - INTERVAL '1 day'`, covering today and yesterday |
| 2 | Excludes `opportunity`, `quote`, `quotedetails`, and `salesorderssalesorderdetails` entities, plus messages containing `"connection error"` |
| 3 | Accepts optional `limit` (1–500, default 100), `search` (ILIKE on entity name, record ID, error message), and `entity` (exact entity set name filter) |
| 4 | Issues two concurrent queries to `sync.error_log`: one for paginated results (deduplicating by latest error per entity+record_id), one for total unique-error count |
| 5 | Returns `{ entries: [...], totalUnique: N }` |

`GET /api/sync/entities` — lists distinct, non-excluded `entity_set_name` values with their error
counts for today and yesterday, used to populate the entity filter dropdown.

Both endpoints are **read-only**. No audit entries are written.

---

## 12. Work Order Purge

**Route:** `/work-order-purge`  
**API prefix:** `/api/work-order-purge`

### 12.1 Problem this solves

The D365 F&O BYOD (Bring Your Own Database) incremental export only pushes inserts and updates to the Azure PostgreSQL staging mirror (schema `d365fo`). When a production order is **deleted in F&O**, its rows remain in the staging tables forever and continue to appear in downstream applications. This tool removes those orphaned rows safely.

### 12.2 Affected tables

All tables are in the `d365fo` schema. Each has a **live** table and a corresponding **`_load`** twin used during export. The purge targets both for every entry in the list:

| Table | Key column |
|---|---|
| `prodproductionorderheaderstaging` | `productionordernumber` |
| `prodproductionorderbillofmaterialslinestaging` | `productionordernumber` |
| `prodproductionorderrouteoperationstaging` | `productionordernumber` |
| `prodproductionorderrouteoperationresourcerequirementstaging` (truncated to 63 chars) | `productionordernumber` |
| `prodproductionpickinglistjournalentrystaging` | `productionordernumber` |
| `prodroutecardproductionjournalentrystaging` | `productionordernumber` |
| `prodproductionroutetransactionstaging` | `torefnumber` |
| `wrkctroperationsresourcecapacityreservationstaging` | `productionordernumber` |

### 12.3 Safety guarantees

- Every delete is filtered by **both** the explicit order-number list **and** `dataareaid = 'TOUS'`. Rows for other companies (e.g. `TOUK`) sharing an order number are never touched.
- All deletes run inside a **single PostgreSQL transaction**. On any error the transaction is rolled back.
- Dry-run mode uses `SELECT count(*)` and then `ROLLBACK` — zero rows are modified.

### 12.4 Dry-run / execute pattern

The UI enforces a two-step flow:

```
Operator searches for order numbers
        ↓
POST /api/work-order-purge/preview   ← dry run (dryRun: true)
  → returns counts per table, totalRows, no deletes
        ↓
Operator reviews preview and confirms
        ↓
POST /api/work-order-purge/execute   ← live run (dryRun: false)
  → deletes rows, commits transaction
  → writes audit entry (best-effort; purge is NOT rolled back on audit failure)
  → returns counts per table, totalRows
```

### 12.5 Data flow

#### Search

`GET /api/work-order-purge/search?q=<term>`

Queries `d365fo.prodproductionorderheaderstaging` with `productionordernumber ILIKE '%<term>%'` and `dataareaid = 'TOUS'`, returns up to 50 matching order headers. Read-only.

#### Preview

`POST /api/work-order-purge/preview`  
Body: `{ orderNumbers: string[] }`

Runs `purgeWorkOrder(client, orderNumbers, { dryRun: true, dataAreaId: 'TOUS' })`:
- Opens a transaction, issues `SELECT count(*)` against every target table (both live and `_load` twins), then `ROLLBACK`.
- Returns `{ dryRun: true, orderNumbers, counts: { [table]: n }, totalRows }`.

#### Execute

`POST /api/work-order-purge/execute`  
Body: `{ orderNumbers: string[] }`

Runs `purgeWorkOrder(client, orderNumbers, { dryRun: false, dataAreaId: 'TOUS' })`:
- Opens a transaction, issues `DELETE … RETURNING 1` on every table, then `COMMIT`.
- After the commit, writes an audit entry: `purge` / `Work Order` / "Purged N staging row(s) for order(s) X, Y (company TOUS)".
- Audit failure does **not** cause a 500 — the purge has already committed. The error is logged server-side only.
- Returns `{ dryRun: false, orderNumbers, counts: { [table]: n }, totalRows }`.

---

## 13. API Key Authentication (External Callers)

External downstream applications can query the Admin Console's `/access-check` endpoint to look up a user's effective permissions without a browser session.

### Key lifecycle

| Endpoint | Action | Side-effects |
|---|---|---|
| `GET /api/api-keys` | List all keys (hashed; raw key never re-exposed) | — |
| `POST /api/api-keys` | Generate a new key | Generates `ak_<32 random bytes hex>`, stores SHA-256 hash + first 10 characters as prefix. Audit entry. Returns the raw key **once** — it is never stored in plaintext. |
| `DELETE /api/api-keys/:id` | Revoke a key | Sets `revoked_at = NOW()`. Audit entry. The row is retained for audit history. |

### Key format

```
ak_<64 hex characters>
  └── first 10 chars displayed in UI as "key prefix" for identification
```

Keys are scoped to a single app (`app_name`). A key for "Field Service" cannot be used to query access for "Finance".

### Using a key

```
GET /api/access-check?entraObjectId=<oid>&app=<appName>
X-API-Key: ak_...
```

See [Section 4.3](#43-how-access-check-evaluates-a-request) for the full evaluation logic.

---

## 14. Permission Matrix Export

`GET /api/permission-matrix/export`

Returns an Excel workbook (`.xlsx`) built by the `@workspace/permission-matrix` library. The workbook cross-references all roles and resources, showing each role's grant level per resource. Useful for compliance reviews and hand-off documentation.

This endpoint is **read-only** and **session-authenticated** (requires a valid Admin Console session). No audit entry is written.

---

*Document generated from source code review. Last updated: 2026-07-30.*
