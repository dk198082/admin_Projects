# Apps & Roles Security Admin Console — Database Structure

**Target:** Azure Database for PostgreSQL — database `d365crm`
**Generated:** July 8, 2026
**Companion file:** `d365crm-database-schema.sql` (runnable script)

This document describes the complete database structure behind the Admin Console that manages role-based security for the two internal apps: **Production Shop Floor** and **Field Service Calendar**.

---

## 1. Table Overview

| # | Table | Purpose |
|---|-------|---------|
| 1 | `apps` | The internal applications being secured (Production Shop Floor, Field Service Calendar) |
| 2 | `roles` | Security roles (e.g. Admin, Supervisor, Operator, Technician, Dispatcher, Viewer) |
| 3 | `users` | Directory of managed people (name, email, status) |
| 4 | `role_assignments` | Which user holds which role (many-to-many link between `users` and `roles`) |
| 5 | `resources` | Securable items per app — entities, forms, features |
| 6 | `access_grants` | The permission matrix: access level for each role × resource pair |
| 7 | `security_policies` | One security policy row per app (auth method, MFA, session timeout, export policy, etc.) |
| 8 | `audit_log` | Record of every administrative action, with actor and timestamp |
| 9 | `app_user` | Console operators, provisioned automatically on first Microsoft Entra ID sign-in |
| 10 | `session` | Server-side login sessions (used by the web app's session store) |

## 2. Entity Relationships

```
apps ──< resources ──< access_grants >── roles
apps ──< security_policies (1:1 per app)
users ──< role_assignments >── roles
audit_log      (standalone — append-only history)
app_user       (standalone — Entra ID sign-ins)
session        (standalone — web sessions)
```

- `>──` / `──<` = one-to-many; junction tables (`role_assignments`, `access_grants`) resolve many-to-many relationships.
- All foreign keys use `ON DELETE CASCADE`, so deleting an app removes its resources, grants, and policy; deleting a user or role removes their assignments.

## 3. Table Definitions

### 3.1 `apps`
| Column | Type | Constraints |
|--------|------|-------------|
| `id` | serial | PRIMARY KEY |
| `name` | text | NOT NULL, UNIQUE |

### 3.2 `roles`
| Column | Type | Constraints |
|--------|------|-------------|
| `id` | serial | PRIMARY KEY |
| `name` | text | NOT NULL, UNIQUE |
| `description` | text | NOT NULL, default `''` |

### 3.3 `users`
| Column | Type | Constraints |
|--------|------|-------------|
| `id` | serial | PRIMARY KEY |
| `name` | text | NOT NULL |
| `email` | text | NOT NULL, UNIQUE |
| `status` | text | NOT NULL, default `'active'` |
| `created_at` | timestamptz | NOT NULL, default `now()` |

### 3.4 `role_assignments`
| Column | Type | Constraints |
|--------|------|-------------|
| `id` | serial | PRIMARY KEY |
| `user_id` | integer | NOT NULL, FK → `users(id)` ON DELETE CASCADE |
| `role_id` | integer | NOT NULL, FK → `roles(id)` ON DELETE CASCADE |
| `created_at` | timestamptz | NOT NULL, default `now()` |
| | | UNIQUE (`user_id`, `role_id`) |

### 3.5 `resources`
| Column | Type | Constraints |
|--------|------|-------------|
| `id` | serial | PRIMARY KEY |
| `app_id` | integer | NOT NULL, FK → `apps(id)` ON DELETE CASCADE |
| `name` | text | NOT NULL |
| `type` | text | NOT NULL (e.g. Entity, Form, Feature) |
| `description` | text | NOT NULL, default `''` |

### 3.6 `access_grants`
| Column | Type | Constraints |
|--------|------|-------------|
| `id` | serial | PRIMARY KEY |
| `role_id` | integer | NOT NULL, FK → `roles(id)` ON DELETE CASCADE |
| `resource_id` | integer | NOT NULL, FK → `resources(id)` ON DELETE CASCADE |
| `level` | text | NOT NULL (e.g. Full, Edit, Read, None) |
| | | UNIQUE (`role_id`, `resource_id`) |

### 3.7 `security_policies`
| Column | Type | Constraints |
|--------|------|-------------|
| `id` | serial | PRIMARY KEY |
| `app_id` | integer | NOT NULL, FK → `apps(id)` ON DELETE CASCADE, UNIQUE |
| `auth_method` | text | NOT NULL, default `'SSO (Entra ID)'` |
| `mfa_required` | text | NOT NULL, default `'All users'` |
| `session_timeout_minutes` | integer | NOT NULL, default `30` |
| `record_level_scope` | text | NOT NULL, default `''` |
| `field_level_rules` | text | NOT NULL, default `''` |
| `audit_logging` | boolean | NOT NULL, default `true` |
| `data_export_policy` | text | NOT NULL, default `''` |

### 3.8 `audit_log`
| Column | Type | Constraints |
|--------|------|-------------|
| `id` | serial | PRIMARY KEY |
| `action` | text | NOT NULL (e.g. create, update, delete, login) |
| `entity` | text | NOT NULL (e.g. User, Role, Access Grant, Session) |
| `detail` | text | NOT NULL, default `''` |
| `actor` | text | NOT NULL, default `'System Administrator'` |
| `created_at` | timestamptz | NOT NULL, default `now()` |

### 3.9 `app_user`
| Column | Type | Constraints |
|--------|------|-------------|
| `id` | serial | PRIMARY KEY |
| `entra_object_id` | text | NOT NULL, UNIQUE (Microsoft Entra ID object ID) |
| `email` | text | NOT NULL |
| `name` | text | NOT NULL |
| `last_login_at` | timestamp | NOT NULL, default `now()` |
| `created_at` | timestamp | NOT NULL, default `now()` |

### 3.10 `session`
| Column | Type | Constraints |
|--------|------|-------------|
| `sid` | varchar | PRIMARY KEY |
| `sess` | json | NOT NULL |
| `expire` | timestamp(6) | NOT NULL, indexed (`IDX_session_expire`) |

## 4. Creating the Schema in Azure PostgreSQL

Run the companion script against your `d365crm` database:

```bash
psql "host=<your-server>.postgres.database.azure.com port=5432 dbname=d365crm user=<your-user> sslmode=require" \
  -f d365crm-database-schema.sql
```

Notes:
- The script creates a dedicated schema `admin_console` and puts all tables there, keeping them separate from any existing CRM objects in `d365crm`. If you prefer the default `public` schema, delete the first two statements (`CREATE SCHEMA` / `SET search_path`).
- `sslmode=require` is mandatory for Azure Database for PostgreSQL.
- The script is ordered so parent tables (`apps`, `roles`, `users`) are created before child tables with foreign keys.
- Recommended indexes on foreign-key columns and `audit_log.created_at` are included at the end.

## 5. Full CREATE Statements

The complete, runnable DDL is in `d365crm-database-schema.sql`. Summary of what it contains, in order:

1. `CREATE SCHEMA admin_console` + `SET search_path`
2. `CREATE TABLE` for all 10 tables (with primary keys, unique constraints, defaults, and foreign keys inline)
3. `CREATE INDEX` statements for FK lookup columns and the audit log timestamp
