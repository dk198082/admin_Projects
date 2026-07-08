---
name: API server error handling & date serialization
description: Two recurring gotchas when wiring Express + Drizzle + generated Zod schemas in this repo
---

- Drizzle `timestamp` columns return `Date` objects, but the Orval-generated Zod response schemas expect `string`. Always map `createdAt: row.createdAt.toISOString()` before `.parse()` or responses 500 with ZodError.
- Postgres error codes (23503 FK, 23505 unique) may be nested under `err.cause`, not directly on the thrown error. The central error handler in `artifacts/api-server/src/app.ts` walks the cause chain to map them to 400s.

**Why:** Both surfaced as opaque 500s/HTML stack traces during the Admin Console build.
**How to apply:** Any new route returning timestamp columns or inserting FK references.
