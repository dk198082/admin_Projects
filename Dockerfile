# syntax=docker/dockerfile:1
#
# Builds ONE container that runs the Express API (artifacts/api-server) and
# serves BOTH frontends as static files:
#   artifacts/workspace-shell  -> site root "/"     (the Digital Workspace launcher)
#   artifacts/admin-console    -> "/admin-console/"  (one of the launchable tiles)
# so the whole workspace deploys as a single Azure App Service (Web App for
# Containers) or Azure Container Apps instance.
#
# See AZURE_DEPLOYMENT.md and docs/workspace/TECHNICAL_DESIGN.md for the
# required Azure resources and environment variables (AZURE_DATABASE_URL,
# SESSION_SECRET, AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET,
# etc.) — none of those are baked into the image; they're supplied at deploy
# time as App Settings / Container Apps secrets.
#
# This is a single-stage build (not multi-stage). pnpm workspaces hoist
# dependencies via symlinks into a content-addressable store, which is fragile
# to split across build/runtime stages with a plain `COPY`. Building and
# running from the same image is a bit larger but reliable; shrink it later
# with a multi-stage `pnpm deploy` step if image size becomes a problem.

FROM node:24-bookworm-slim

WORKDIR /repo

RUN corepack enable

# Copy just the manifests first so `pnpm install` is cached across builds that
# only change application source.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY artifacts/api-server/package.json artifacts/api-server/package.json
COPY artifacts/admin-console/package.json artifacts/admin-console/package.json
COPY artifacts/workspace-shell/package.json artifacts/workspace-shell/package.json
COPY artifacts/mockup-sandbox/package.json artifacts/mockup-sandbox/package.json
COPY lib/api-client-react/package.json lib/api-client-react/package.json
COPY lib/api-spec/package.json lib/api-spec/package.json
COPY lib/api-zod/package.json lib/api-zod/package.json
COPY lib/db/package.json lib/db/package.json
COPY lib/permission-matrix/package.json lib/permission-matrix/package.json
COPY scripts/package.json scripts/package.json

RUN pnpm install --frozen-lockfile

# Now copy the rest of the source and build everything.
COPY . .

# vite.config.ts (every frontend artifact) requires PORT and BASE_PATH to even
# *load* the config, for both `dev` and `build`. PORT is a dummy value here —
# only read at build time, doesn't affect the runtime container. BASE_PATH is
# real: it must match the mount path each frontend is served at (see the
# STATIC_ROOT_DIR block in artifacts/api-server/src/app.ts) or its asset URLs
# would resolve to the wrong path and 404.
ENV PORT=4173

RUN BASE_PATH=/                  pnpm --filter @workspace/workspace-shell run build \
 && BASE_PATH=/admin-console/     pnpm --filter @workspace/admin-console run build

# Typechecks + builds the API server (mockup-sandbox is deliberately skipped —
# not served by this image).
RUN pnpm run typecheck:libs
RUN pnpm --filter @workspace/api-server run build

# Arrange both builds under one directory, matching what STATIC_ROOT_DIR
# expects: <root>/<app-name>/index.html
RUN mkdir -p /repo/static-root \
 && cp -r artifacts/workspace-shell/dist/public  /repo/static-root/workspace-shell \
 && cp -r artifacts/admin-console/dist/public    /repo/static-root/admin-console

# --- Runtime ---------------------------------------------------------------
ENV NODE_ENV=production
# Azure App Service for Containers / Container Apps inject PORT themselves
# (App Service defaults to 8080 for custom containers); this is just the
# in-container default so `docker run -p 8080:8080` works out of the box.
ENV PORT=8080
ENV STATIC_ROOT_DIR=/repo/static-root

EXPOSE 8080

# Azure App Service / Container Apps health probes can point at GET /api/healthz.
WORKDIR /repo/artifacts/api-server
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
