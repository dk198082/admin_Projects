# syntax=docker/dockerfile:1

# -----------------------------------------------------------------------------
# TOCRM Digital Workspace
#
# ONE container runs:
#
#   Express API
#       artifacts/api-server
#
#   Digital Workspace
#       artifacts/workspace-shell
#       served at /
#
#   Admin Console
#       artifacts/admin-console
#       served at /admin-console/
#
# This container is intended for:
#
#   - Azure App Service for Containers
#   - Azure Container Apps
#   - Local Docker testing
#
# Runtime configuration is supplied through environment variables / Azure
# App Settings. Secrets are NOT baked into the image.
# -----------------------------------------------------------------------------

FROM node:24-bookworm-slim

WORKDIR /repo

# -----------------------------------------------------------------------------
# Package manager
# -----------------------------------------------------------------------------

RUN corepack enable

# -----------------------------------------------------------------------------
# Copy package manifests first.
#
# This allows Docker to cache pnpm install when application source code changes
# but package manifests / lockfile have not changed.
# -----------------------------------------------------------------------------

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

COPY artifacts/api-server/package.json \
     artifacts/api-server/package.json

COPY artifacts/admin-console/package.json \
     artifacts/admin-console/package.json

COPY artifacts/workspace-shell/package.json \
     artifacts/workspace-shell/package.json

COPY artifacts/mockup-sandbox/package.json \
     artifacts/mockup-sandbox/package.json

COPY lib/api-client-react/package.json \
     lib/api-client-react/package.json

COPY lib/api-spec/package.json \
     lib/api-spec/package.json

COPY lib/api-zod/package.json \
     lib/api-zod/package.json

COPY lib/db/package.json \
     lib/db/package.json

COPY lib/permission-matrix/package.json \
     lib/permission-matrix/package.json

COPY scripts/package.json \
     scripts/package.json

# -----------------------------------------------------------------------------
# Install dependencies
# -----------------------------------------------------------------------------

RUN pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# Copy application source
# -----------------------------------------------------------------------------

COPY . .

# -----------------------------------------------------------------------------
# Build-time Vite configuration
#
# Vite configs require PORT and BASE_PATH.
#
# PORT:
#   Only required so the Vite configuration can load during Docker build.
#
# BASE_PATH:
#   Must match the URL path where the frontend will be served.
# -----------------------------------------------------------------------------

ENV PORT=4173

# -----------------------------------------------------------------------------
# Build Digital Workspace
#
# Served at:
#   /
# -----------------------------------------------------------------------------

RUN BASE_PATH=/ \
    pnpm --filter @workspace/workspace-shell run build

# -----------------------------------------------------------------------------
# Build Admin Console
#
# Served at:
#   /admin-console/
# -----------------------------------------------------------------------------

RUN BASE_PATH=/admin-console/ \
    pnpm --filter @workspace/admin-console run build

# -----------------------------------------------------------------------------
# Build shared libraries
# -----------------------------------------------------------------------------

RUN pnpm run typecheck:libs

# -----------------------------------------------------------------------------
# Build Express API server
# -----------------------------------------------------------------------------

RUN pnpm --filter @workspace/api-server run build

# -----------------------------------------------------------------------------
# Create static root
#
# API server STATIC_ROOT_DIR expects:
#
#   /repo/static-root/
#       workspace-shell/
#           index.html
#
#       admin-console/
#           index.html
# -----------------------------------------------------------------------------

RUN mkdir -p /repo/static-root \
    && cp -r artifacts/workspace-shell/dist/public \
       /repo/static-root/workspace-shell \
    && cp -r artifacts/admin-console/dist/public \
       /repo/static-root/admin-console

# -----------------------------------------------------------------------------
# Runtime configuration
# -----------------------------------------------------------------------------

ENV NODE_ENV=production

# Azure App Service / Container Apps normally supplies PORT.
# 8080 is the local/default container port.
ENV PORT=8080

# Express uses this directory to serve the two frontend applications.
ENV STATIC_ROOT_DIR=/repo/static-root

# -----------------------------------------------------------------------------
# Container port
# -----------------------------------------------------------------------------

EXPOSE 8080

# -----------------------------------------------------------------------------
# Runtime working directory
# -----------------------------------------------------------------------------

WORKDIR /repo/artifacts/api-server

# -----------------------------------------------------------------------------
# Start Express API
#
# Express serves:
#
#   /
#       Digital Workspace
#
#   /admin-console/
#       Admin Console
#
#   /api/*
#       Backend API
# -----------------------------------------------------------------------------

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]