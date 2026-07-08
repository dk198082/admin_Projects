---
name: Azure PostgreSQL connection quirks
description: Handling user-provided Azure PG connection strings, schema targeting, and TLS
---

Rules learned connecting an app to an external Azure Database for PostgreSQL:

- User-pasted connection strings often contain unencoded special characters in the password (`!$#^%`), which `new URL()` and psql reject ("invalid percent-encoded token"). Parse manually (split userinfo at first colon) and pass discrete pg PoolConfig fields instead of a connectionString.
- **Why:** re-asking users to percent-encode passwords is error-prone; lenient parsing makes any pasted DSN work.
- To target a non-public schema for both Drizzle and connect-pg-simple, set `options: "-csearch_path=<schema>"` on the pool — unqualified table names then resolve correctly for both.
- Azure PG certs chain to public CAs, so `ssl: { rejectUnauthorized: true }` works — prefer it over `sslmode=require` semantics.
- Keep drizzle-kit tooling on the same DB: derive its URL from the same config helper (percent-encode credentials, include `options=-csearch_path...`), or schema pushes drift to the old DB.
- Data migration between schemas: `pg_dump --data-only` + `sed 's/public\./<schema>./g'`, then reset serial sequences with `setval(pg_get_serial_sequence(...), max(id)+1, false)`.
