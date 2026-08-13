---
name: E2E testing behind Entra ID
description: How to run Playwright e2e tests against the auth-gated Admin Console without a real Microsoft login.
---

Playwright test agents cannot complete a real Microsoft Entra login, but sessions live in Postgres (connect-pg-simple), so a valid session can be injected.

**How to apply:**
1. Insert a row into the `session` table with a known `sid` and `sess` JSON `{ cookie: {...}, user: { id, entraObjectId, email, name } }` for an existing `app_user`, expire ~8h out.
2. Compute the signed cookie value: `'s:' + sid + '.' + base64(hmacSHA256(sid, SESSION_SECRET))` with trailing `=` stripped; URL-encode it and pass as `connect.sid` cookie in the test plan (the test agent sets it on the browser context before navigating).
3. Node 24's `--experimental-strip-types` lets a one-off `.mjs` script import `lib/db/src/poolConfig.ts` directly (lib dist is declaration-only, so there is no built JS to import).
4. Clean up afterward: delete the injected `session` row (sid prefix like `e2e-test-%`) and any test users created via API.

**Why:** The dev DB is shared/real; injecting a session for an existing admin user makes audit entries attributable and avoids touching auth code. Verified working 2026-07-22.
