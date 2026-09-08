#!/usr/bin/env bash
# check-overview-drift.sh
#
# Lightweight CI-style check that docs/APP_OVERVIEW.md covers every
# route file and every schema table that exists in the codebase.
#
# Exit 0 = no drift detected
# Exit 1 = one or more mismatches found (details printed to stdout)
#
# Usage:
#   bash scripts/check-overview-drift.sh

set -euo pipefail

OVERVIEW="docs/APP_OVERVIEW.md"
ROUTES_DIR="artifacts/api-server/src/routes"
SCHEMA_DIR="lib/db/src/schema"

ERRORS=0

fail() {
  echo "  ✗ $1"
  ERRORS=$((ERRORS + 1))
}

pass() {
  echo "  ✓ $1"
}

# ---------------------------------------------------------------------------
# Helper: assert that a grep pattern exists in the overview
# ---------------------------------------------------------------------------
assert_in_overview() {
  local label="$1"
  local pattern="$2"
  if grep -qF "$pattern" "$OVERVIEW"; then
    pass "$label  →  \"$pattern\" found"
  else
    fail "$label  →  \"$pattern\" NOT found in $OVERVIEW"
  fi
}

echo ""
echo "========================================"
echo " docs/APP_OVERVIEW.md drift check"
echo "========================================"

# ---------------------------------------------------------------------------
# 1. Route files → API path prefixes
#
#    For each route file that maps to a feature section, verify that its
#    primary API path prefix appears somewhere in the overview.
#    (health.ts and entra.ts are intentionally coverage-only helpers that
#    are documented within other sections rather than having their own.)
# ---------------------------------------------------------------------------
echo ""
echo "── Route files vs overview sections ────────────────────────────────────"

declare -A ROUTE_PATHS
ROUTE_PATHS=(
  ["auth.ts"]="/api/auth"
  ["accessCheck.ts"]="/access-check"
  ["users.ts"]="/api/users"
  ["roles.ts"]="/api/roles"
  ["appsResources.ts"]="/api/apps"
  ["grants.ts"]="/api/access-grants"
  ["security.ts"]="/api/security-policies"
  ["audit.ts"]="/api/audit-log"
  ["sync.ts"]="/api/sync"
  ["apiKeys.ts"]="/api/api-keys"
  ["permissionMatrix.ts"]="/api/permission-matrix"
  ["accessMapping.ts"]="/api/access-mapping"
  ["workOrderPurge.ts"]="/api/work-order-purge"
)

for route_file in "${!ROUTE_PATHS[@]}"; do
  api_path="${ROUTE_PATHS[$route_file]}"
  full_path="$ROUTES_DIR/$route_file"

  # If the route file no longer exists, flag it — the overview may reference
  # a deleted module, or a new file was added without updating this script.
  if [[ ! -f "$full_path" ]]; then
    fail "$route_file  →  file not found at $full_path (remove from this check or add the file)"
    continue
  fi

  assert_in_overview "$route_file" "$api_path"
done

# Check for route files in routes/ that are NOT in our known map — new
# files added without updating CONTRIBUTING.md or this script.
echo ""
echo "── New/unknown route files ──────────────────────────────────────────────"
KNOWN_ROUTES="health.ts entra.ts index.ts auth.ts accessCheck.ts accessCheck.test.ts users.ts roles.ts appsResources.ts grants.ts security.ts audit.ts sync.ts apiKeys.ts apiKeys.test.ts apiKeys.auth-enforcement.test.ts permissionMatrix.ts accessMapping.ts workOrderPurge.ts requireAuth.integration.test.ts"

for f in "$ROUTES_DIR"/*.ts; do
  basename_f="$(basename "$f")"
  if ! echo "$KNOWN_ROUTES" | grep -qw "$basename_f"; then
    fail "Unknown route file: $basename_f — add it to CONTRIBUTING.md and this script, then document it in $OVERVIEW"
  else
    pass "$basename_f is accounted for"
  fi
done

# ---------------------------------------------------------------------------
# 2. Schema files → Mermaid ERD table blocks
#
#    Each schema file (excluding index.ts) should have its primary table
#    name present inside the Mermaid ERD block in the overview.
# ---------------------------------------------------------------------------
echo ""
echo "── Schema files vs ERD ──────────────────────────────────────────────────"

declare -A SCHEMA_TABLES
SCHEMA_TABLES=(
  ["apps.ts"]="apps {"
  ["appUsers.ts"]="app_user {"
  ["users.ts"]="users {"
  ["roles.ts"]="roles {"
  ["resources.ts"]="resources {"
  ["accessGrants.ts"]="access_grants {"
  ["roleAssignments.ts"]="role_assignments {"
  ["securityPolicies.ts"]="security_policies {"
  ["auditLog.ts"]="audit_log {"
  ["apiKeys.ts"]="api_keys {"
)

for schema_file in "${!SCHEMA_TABLES[@]}"; do
  table_marker="${SCHEMA_TABLES[$schema_file]}"
  full_path="$SCHEMA_DIR/$schema_file"

  if [[ ! -f "$full_path" ]]; then
    fail "$schema_file  →  file not found at $full_path (remove from this check or add the file)"
    continue
  fi

  assert_in_overview "$schema_file" "$table_marker"
done

# Check for schema files not in our known map
echo ""
echo "── New/unknown schema files ─────────────────────────────────────────────"
KNOWN_SCHEMAS="index.ts apps.ts appUsers.ts users.ts roles.ts resources.ts accessGrants.ts roleAssignments.ts securityPolicies.ts auditLog.ts apiKeys.ts"

for f in "$SCHEMA_DIR"/*.ts; do
  basename_f="$(basename "$f")"
  if ! echo "$KNOWN_SCHEMAS" | grep -qw "$basename_f"; then
    fail "Unknown schema file: $basename_f — add its table to the ERD in $OVERVIEW and register it in this script"
  else
    pass "$basename_f is accounted for"
  fi
done

# ---------------------------------------------------------------------------
# 3. Table of Contents section headers
#
#    The ToC lists 14 sections. Verify the markdown headers they link to
#    are still present, so a section rename breaks the check immediately.
# ---------------------------------------------------------------------------
echo ""
echo "── Table of Contents section headers ───────────────────────────────────"

TOC_HEADERS=(
  "## 1. Overview"
  "## 2. Authentication"
  "## 3. Data Model"
  "## 4. Access Model"
  "## 5. Dashboard"
  "## 6. Users"
  "## 7. Map User Security Access"
  "## 8. Permissions"
  "## 9. Security Policies"
  "## 10. Audit Log"
  "## 11. Data Sync Error Log"
  "## 12. Work Order Purge"
  "## 13. API Key Authentication"
  "## 14. Permission Matrix Export"
)

for header in "${TOC_HEADERS[@]}"; do
  if grep -qF "$header" "$OVERVIEW"; then
    pass "Section header found: \"$header\""
  else
    fail "Section header missing: \"$header\" — was a section renamed or removed?"
  fi
done

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "========================================"
if [[ $ERRORS -eq 0 ]]; then
  echo " ✓  All checks passed — no drift detected"
  echo "========================================"
  echo ""
  exit 0
else
  echo " ✗  $ERRORS check(s) failed — review the output above"
  echo "    Update docs/APP_OVERVIEW.md and/or this script to fix them."
  echo "========================================"
  echo ""
  exit 1
fi
