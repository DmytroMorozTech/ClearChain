# Build from the repository root, not from backend/:
#   docker build -f backend/Dockerfile -t clearchain-api .
# The lockfile governs the whole npm workspace, so the build context has to include it.

# ── builder ──────────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder
WORKDIR /app

# Manifests first, so a source-only change does not invalidate the install layer.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY backend ./backend

# Runs `prisma generate` and then `tsc`. Generate works without a database because
# prisma.config.ts reads DATABASE_URL from process.env rather than through Prisma's
# env() helper, which throws while the config file is loading.
RUN npm run build -w @clearchain/backend

# The seed runs from this stage and writes certificate PDFs into the uploads volume.
# Making the mount point node-owned here means the volume is initialised node-owned on
# first mount, so the runtime API (which runs as node) can write into it too. The seed
# service runs as the same uid; see docker-compose.prod.yml.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json

# Only the backend workspace, and only its production dependencies. Without the
# workspace filter this would also install React, MUI and Recharts into an image that
# serves no HTML.
# @prisma/client declares `prisma` and `typescript` as OPTIONAL peer dependencies -- it
# states outright that the runtime works without them. npm installs optional peers all
# the same, and `npm ci` ignores --omit=peer, so they arrive anyway and bring the CLI's
# whole tree with them: Prisma Studio, the engine downloader, effect, elkjs, react-dom.
# That is roughly 230 MB that `node dist/index.js` never reaches; the application talks
# to the database through the generated client and the pg adapter alone.
#
# Dropping them is what makes the specification's promise true -- no TypeScript compiler
# in the shipped image -- and every endpoint is exercised against this image afterwards
# to prove nothing that matters went with them.
RUN npm ci --omit=dev --workspace @clearchain/backend --include-workspace-root \
  && npm cache clean --force \
  && rm -rf \
    node_modules/prisma \
    node_modules/typescript \
    node_modules/@prisma/studio-core \
    node_modules/@prisma/dev \
    node_modules/@prisma/engines \
    node_modules/effect \
    node_modules/@electric-sql \
    node_modules/elkjs \
    node_modules/react-dom \
    node_modules/.bin/prisma \
    node_modules/.bin/tsc \
    node_modules/.bin/tsserver

# The generated Prisma client is build output, not a package. `npm ci` above installed
# @prisma/client, but not what `prisma generate` wrote into it — and the Prisma CLI is a
# devDependency, so this stage could not regenerate it. Copying both directories is what
# keeps the image able to talk to the database at all.
#
# Prisma 7 compiles queries to WASM instead of shipping a Rust engine, so there are no
# platform-specific engine binaries to match against this base image.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Compiled JavaScript only: tsconfig.build.json excludes tests, and no .ts file or
# TypeScript compiler reaches this stage.
COPY --from=builder /app/backend/dist ./backend/dist

# Read at runtime: the country risk table and the mock ERP export.
COPY --from=builder /app/backend/data ./backend/data

# The schema, the migrations and the seed script are deliberately NOT copied. Migrations
# are applied from a separate step that carries the Prisma CLI, never on application
# start where a slow or failed migration would take the service down with it. Copying
# them here would also put TypeScript source files back into an image whose whole point
# is to contain none.

# Created and owned by node before dropping privileges, so a freshly-created uploads
# volume mounts node-writable. Without this the mount point is root-owned and the
# non-root process gets EACCES on the first certificate upload.
RUN mkdir -p /app/uploads && chown node:node /app/uploads

EXPOSE 3001
USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/dist/index.js"]
