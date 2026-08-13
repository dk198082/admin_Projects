# syntax=docker/dockerfile:1
#
# Builds ONE container that runs the Express API (artifacts/api-server) and
# also serves the built frontend (artifacts/admin-console) as static files,
# so the whole app deploys as a single Azure App Service (Web App for
# Containers) or Azure Container Apps instance.
#
# See AZURE_DEPLOYMENT.md for the required Azure resources and environment
# variables (AZURE_DATABASE_URL, SESSION_SECRET, AZURE_TENANT_ID,
# AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, etc.) — none of those are baked into
# the image; they're supplied at deploy time as App Settings / Container Apps
# secrets.
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

# vite.config.ts (both frontend artifacts) requires PORT and BASE_PATH to even
# *load* the config, for both `dev` and `build`. These two values are only
# read at build time to bake the app's base URL into the built assets — they
# do NOT affect the running container (that's controlled by PORT below and the
# STATIC_DIR the Express server serves from). BASE_PATH=/ because the API
# server serves the SPA from the site root.
ENV PORT=4173
ENV BASE_PATH=/

# Typechecks + builds every workspace package (api-server's esbuild bundle,
# every Vite frontend, etc.) — see root package.json "build" script. Slightly
# more than strictly required (it also builds mockup-sandbox, which this image
# doesn't serve) but keeps the Docker build in lockstep with `pnpm run build`,
# the same command CI/local dev already use.
RUN pnpm run build

# --- Runtime ---------------------------------------------------------------
ENV NODE_ENV=production
# Azure App Service for Containers / Container Apps inject PORT themselves
# (App Service defaults to 8080 for custom containers); this is just the
# in-container default so `docker run -p 8080:8080` works out of the box.
ENV PORT=8080
# Tell the API server where the built SPA lives so it serves it itself
# (see the STATIC_DIR block in artifacts/api-server/src/app.ts).
ENV STATIC_DIR=/repo/artifacts/admin-console/dist/public

EXPOSE 8080

# Azure App Service / Container Apps health probes can point at GET /api/healthz.
WORKDIR /repo/artifacts/api-server
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
