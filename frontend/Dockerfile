# Build from the repository root:
#   docker build -f frontend/Dockerfile -t clearchain-web .

FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY frontend ./frontend

# `tsc --noEmit` runs first, so a type error fails the build rather than shipping.
RUN npm run build -w @clearchain/frontend

FROM nginx:1.27-alpine AS runtime

# No VITE_API_BASE_URL is baked in: nginx proxies /api on the same origin, so the
# frontend calls a relative path. Same origin also means no CORS and a session cookie
# that simply works, rather than one that needs SameSite=None and third-party-cookie
# exemptions to survive.
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY docker/nginx/app.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost/ >/dev/null || exit 1
