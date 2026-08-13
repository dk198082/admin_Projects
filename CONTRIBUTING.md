# Contributing

Thank you for contributing to the Admin Console. This guide explains the conventions that keep the codebase and its documentation in sync.

---

## Keeping `docs/APP_OVERVIEW.md` up to date

`docs/APP_OVERVIEW.md` is the authoritative plain-English description of every feature, API endpoint, and data flow in the system. It was written from source code and must stay in sync with the code manually — **no tool auto-generates it**.

### When you must update the overview

| What changed | What to update in the overview |
|---|---|
| A new route file added to `artifacts/api-server/src/routes/` | Add a new section (or subsection) describing the endpoints, their inputs, outputs, and side-effects |
| An existing route file removed or renamed | Remove or rename the corresponding section; update the Table of Contents |
| An endpoint's URL, method, request body, or response shape changed | Update the matching data-flow table in the relevant section |
| A new table added to `lib/db/src/schema/` | Add the table to the Mermaid ERD in **Section 3** and describe it in the relevant feature section |
| An existing schema file changed (column added/removed/renamed) | Update the Mermaid ERD in **Section 3** and any data-flow tables that reference those columns |
| The access-check evaluation logic changed | Update the numbered steps in **Section 4.3** |
| The authentication flow changed | Update the sequence diagram in **Section 2.1** |
| A new entitlement-management behaviour added | Update **Section 4.2** and **Section 7** |

### Source files that must trigger a doc review

These are the files most likely to diverge from the overview. Before merging a PR that touches any of them, check whether `docs/APP_OVERVIEW.md` needs updating:

```
artifacts/api-server/src/routes/index.ts      ← router registration order & auth boundary
artifacts/api-server/src/routes/*.ts          ← each file = one feature section in the overview
lib/db/src/schema/*.ts                        ← each file = one or more ERD tables
artifacts/api-server/src/middlewares/requireAuth.ts  ← auth guard described in Section 2.4
```

### Running the drift check locally

A script checks that every route file registered in `routes/index.ts` has a matching API path documented in `docs/APP_OVERVIEW.md`, and that every schema table appears in the Mermaid ERD:

```bash
bash scripts/check-overview-drift.sh
```

The same check runs as a registered validation step (`docs-drift`). Run it via the Replit validation panel or from the shell before merging.

---

## Commit conventions

- Use the imperative mood in commit subjects: `Add bulk-disable endpoint`, not `Added bulk-disable endpoint`.
- Prefix commits that touch only documentation with `docs:` (e.g. `docs: update APP_OVERVIEW for work-order-purge changes`).

## Local development

```bash
# Start all services
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/admin-console run dev
```

See `replit.md` for environment variable requirements.
