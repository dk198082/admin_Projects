-- ============================================================
-- Apps & Roles Security Admin Console — Database Schema
-- Target: Azure Database for PostgreSQL — database: d365crm
-- Generated: 2026-07-08
--
-- Usage:
--   psql "host=<server>.postgres.database.azure.com dbname=d365crm user=<user> sslmode=require" -f d365crm-database-schema.sql
-- ============================================================

-- Optional: keep all Admin Console objects in a dedicated schema.
-- If you prefer the default "public" schema, delete these two lines.
CREATE SCHEMA IF NOT EXISTS admin_console;
SET search_path TO admin_console;

-- ------------------------------------------------------------
-- 1. apps — the internal applications being secured
-- ------------------------------------------------------------
CREATE TABLE apps (
    id      serial PRIMARY KEY,
    name    text NOT NULL,
    CONSTRAINT apps_name_unique UNIQUE (name)
);

-- ------------------------------------------------------------
-- 2. roles — security roles shared across apps
-- ------------------------------------------------------------
CREATE TABLE roles (
    id          serial PRIMARY KEY,
    name        text NOT NULL,
    description text NOT NULL DEFAULT '',
    CONSTRAINT roles_name_unique UNIQUE (name)
);

-- ------------------------------------------------------------
-- 3. users — managed people (directory of user records)
-- ------------------------------------------------------------
CREATE TABLE users (
    id          serial PRIMARY KEY,
    name        text NOT NULL,
    email       text NOT NULL,
    status      text NOT NULL DEFAULT 'active',
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_email_unique UNIQUE (email)
);

-- ------------------------------------------------------------
-- 4. role_assignments — which user holds which role (many-to-many)
-- ------------------------------------------------------------
CREATE TABLE role_assignments (
    id          serial PRIMARY KEY,
    user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id     integer NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT role_assignments_user_role_unique UNIQUE (user_id, role_id)
);

-- ------------------------------------------------------------
-- 5. resources — securable items (entities/forms/features) per app
-- ------------------------------------------------------------
CREATE TABLE resources (
    id          serial PRIMARY KEY,
    app_id      integer NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    name        text NOT NULL,
    type        text NOT NULL,
    description text NOT NULL DEFAULT ''
);

-- ------------------------------------------------------------
-- 6. access_grants — the permission matrix (role × resource → level)
--    level examples: 'Full', 'Edit', 'Read', 'None'
-- ------------------------------------------------------------
CREATE TABLE access_grants (
    id          serial PRIMARY KEY,
    role_id     integer NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    resource_id integer NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    level       text NOT NULL,
    CONSTRAINT access_grants_role_resource_unique UNIQUE (role_id, resource_id)
);

-- ------------------------------------------------------------
-- 7. security_policies — one policy row per app
-- ------------------------------------------------------------
CREATE TABLE security_policies (
    id                      serial PRIMARY KEY,
    app_id                  integer NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    auth_method             text NOT NULL DEFAULT 'SSO (Entra ID)',
    mfa_required            text NOT NULL DEFAULT 'All users',
    session_timeout_minutes integer NOT NULL DEFAULT 30,
    record_level_scope      text NOT NULL DEFAULT '',
    field_level_rules       text NOT NULL DEFAULT '',
    audit_logging           boolean NOT NULL DEFAULT true,
    data_export_policy      text NOT NULL DEFAULT '',
    CONSTRAINT security_policies_app_id_unique UNIQUE (app_id)
);

-- ------------------------------------------------------------
-- 8. audit_log — record of every administrative action
-- ------------------------------------------------------------
CREATE TABLE audit_log (
    id          serial PRIMARY KEY,
    action      text NOT NULL,
    entity      text NOT NULL,
    detail      text NOT NULL DEFAULT '',
    actor       text NOT NULL DEFAULT 'System Administrator',
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 9. app_user — signed-in console operators (JIT-provisioned
--    from Microsoft Entra ID on first login)
-- ------------------------------------------------------------
CREATE TABLE app_user (
    id              serial PRIMARY KEY,
    entra_object_id text NOT NULL,
    email           text NOT NULL,
    name            text NOT NULL,
    last_login_at   timestamp NOT NULL DEFAULT now(),
    created_at      timestamp NOT NULL DEFAULT now(),
    CONSTRAINT app_user_entra_object_id_unique UNIQUE (entra_object_id)
);

-- ------------------------------------------------------------
-- 10. session — server-side login sessions (connect-pg-simple)
-- ------------------------------------------------------------
CREATE TABLE "session" (
    sid     varchar PRIMARY KEY,
    sess    json NOT NULL,
    expire  timestamp(6) NOT NULL
);
CREATE INDEX "IDX_session_expire" ON "session" (expire);

-- ------------------------------------------------------------
-- Recommended supporting indexes for foreign-key lookups
-- ------------------------------------------------------------
CREATE INDEX idx_role_assignments_user_id ON role_assignments (user_id);
CREATE INDEX idx_role_assignments_role_id ON role_assignments (role_id);
CREATE INDEX idx_resources_app_id         ON resources (app_id);
CREATE INDEX idx_access_grants_role_id    ON access_grants (role_id);
CREATE INDEX idx_access_grants_resource_id ON access_grants (resource_id);
CREATE INDEX idx_audit_log_created_at     ON audit_log (created_at DESC);
