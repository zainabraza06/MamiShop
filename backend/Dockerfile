# The MomiShop API.
#
# Build from the repository root, not from backend/: the bundle compiles
# @momishop/shared from source and the lockfile is shared by all workspaces.
#
#   docker build -f backend/Dockerfile -t momishop-api .
#
# Hosts that build from a repository (Render, Railway, Fly) need the same
# setting: Dockerfile path `backend/Dockerfile`, build context the root.

# ── Build ────────────────────────────────────────────────────────────────────
FROM node:20-slim AS build
WORKDIR /repo

# Prisma picks its query engine from the OpenSSL it finds while generating. With
# none installed it guesses debian-openssl-1.1.x, and the runtime image — which
# has OpenSSL 3 — then refuses to start: "could not locate the Query Engine".
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# Manifests first, so a source-only change reuses the cached install layer.
# Every workspace's package.json must be present for the lockfile to resolve,
# even though only the backend's dependencies are installed.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace @momishop/backend --include-workspace-root

COPY shared/ shared/
COPY backend/ backend/

RUN npx prisma generate --schema backend/prisma/schema.prisma
RUN npm run build --workspace @momishop/backend

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Prisma's query engine links against OpenSSL.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev --workspace @momishop/backend --include-workspace-root \
  && npm cache clean --force

# The Prisma client generated against this exact schema, rather than a fresh
# generate here — that would need the Prisma CLI in the runtime image.
COPY --from=build /repo/node_modules/.prisma node_modules/.prisma
COPY --from=build /repo/node_modules/@prisma/client node_modules/@prisma/client
COPY --from=build /repo/backend/dist backend/dist

USER node
EXPOSE 4000

# The API reports 503 while the database is unreachable, so an unhealthy
# container is one that cannot take an order.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT??4000)+'/api/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"

# Migrations are applied by the deploy workflow before this image goes live
# (see docs/DEPLOYMENT.md), so the runtime image carries no Prisma CLI.
CMD ["node", "backend/dist/server.js"]
