---
name: connect-pg-simple with esbuild bundles
description: Why createTableIfMissing breaks in single-file server bundles and the required pattern
---

Rule: never use connect-pg-simple's `createTableIfMissing: true` in a server bundled to a single file with esbuild. Create the `session` table yourself (CREATE TABLE IF NOT EXISTS + expire index) and await it before `app.listen`.

**Why:** `createTableIfMissing` reads `table.sql` from the package directory at runtime; esbuild bundles don't include it, so every session write fails silently (ENOENT dist/table.sql). Symptom: OIDC login fails with "session expired" because codeVerifier/state were never persisted; also caused ERR_HTTP_HEADERS_SENT noise from the error handler firing after redirects.

**How to apply:** in the API server, `ensureSessionTable()` in `app.ts` is awaited in `index.ts` before listen; PgSession gets a shared `pg.Pool` and `createTableIfMissing: false`. Error handler must guard `res.headersSent`.
