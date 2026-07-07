# syntax=docker/dockerfile:1

# ---- Stage 1: build the Vite client (needs devDependencies) ----
FROM node:22-alpine AS build
WORKDIR /app

# Install all deps against the lockfile for a reproducible build.
COPY package.json package-lock.json ./
RUN npm ci

# Build the client -> /app/dist (see vite.config.js: root=client, outDir=../dist)
COPY vite.config.js ./
COPY client ./client
RUN npm run build

# ---- Stage 2: runtime (production deps + server + built client) ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Only production dependencies (express, socket.io, nanoid).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The Node server and the built client it serves.
COPY server ./server
COPY --from=build /app/dist ./dist

# Discord credentials + PORT are injected at runtime (docker run --env-file .env),
# never baked into the image.
ENV PORT=3000
EXPOSE 3000

# Drop root; the node:alpine image ships an unprivileged `node` user.
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider "http://127.0.0.1:${PORT:-3000}/healthz" || exit 1

CMD ["node", "server/index.js"]
