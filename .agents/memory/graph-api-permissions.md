---
name: Microsoft Graph app permissions gotchas
description: Lessons from wiring Graph directory search and sign-in logs via client-credentials
---

- Consent propagation: after granting an application permission + admin consent, fresh tokens can lack the `roles` claim for 5–15 minutes. Decode the JWT payload's `roles` to verify propagation instead of guessing.
- Multiple 403 causes on `/auditLogs/signIns`: even with `AuditLog.Read.All` granted, Graph returns 403 with error code `Authentication_RequestFromNonPremiumTenantOrB2CTenant` when the tenant lacks an Entra ID P1/P2 license. Distinguish 403s by `error.code`, not status alone, and surface an accurate actionable message.
- **Why:** we shipped a "missing permission" message that stayed wrong after the customer granted the permission; the real blocker was the missing premium license.
- **How to apply:** any new Graph API call should map 403 error codes to distinct user-facing messages and be verified with a fresh token (bypassing the server's token cache) when debugging.
- This tenant's app registration is named "Replit-app-login" (client ID ends 933058); as of 2026-07-15 the tenant has no Entra premium license, so sign-in logs API is blocked.
