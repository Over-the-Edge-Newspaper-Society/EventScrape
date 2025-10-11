# Multi-stage build for EventScrape services
FROM node:18-bullseye-slim AS base

# Install system dependencies required during build (git for fallback clone)
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Share playwright browser binaries across users
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Install pnpm
RUN npm install -g pnpm

# Copy everything from the build context (may be incomplete in some environments)
COPY . .

# Fallback: if the build context is missing core files, re-clone the repository
ARG SOURCE_REPO="https://github.com/Over-the-Edge-Newspaper-Society/EventScrape.git"
ARG SOURCE_REF="main"
RUN if [ ! -f package.json ]; then \
      echo "Build context missing package.json, cloning ${SOURCE_REPO}@${SOURCE_REF}" && \
      git clone --depth 1 --branch "${SOURCE_REF}" "${SOURCE_REPO}" /tmp/src && \
      cd / && rm -rf /app && mv /tmp/src /app; \
    fi

# Verify that key workspace files are present before proceeding
RUN ls -la && ls -la apps && ls -la worker

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build API
FROM base AS api-builder
RUN pnpm --filter @eventscrape/api build

# Build Admin
FROM base AS admin-builder
ARG ADMIN_API_URL="http://__HOST__:3001/api"
ENV VITE_API_URL=${ADMIN_API_URL}
RUN pnpm --filter @eventscrape/admin build

# API Production
FROM node:18-bullseye-slim AS api
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates gnupg python3 make g++ \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/postgresql-keyring.gpg] http://apt.postgresql.org/pub/repos/apt bullseye-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-15 \
    && apt-get purge -y --auto-remove curl gnupg \
    && rm -rf /var/lib/apt/lists/*
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 eventscrape
RUN npm install -g pnpm
COPY --from=api-builder --chown=eventscrape:nodejs /app/package.json ./
COPY --from=api-builder --chown=eventscrape:nodejs /app/pnpm-workspace.yaml ./
COPY --from=api-builder --chown=eventscrape:nodejs /app/pnpm-lock.yaml ./
COPY --from=api-builder --chown=eventscrape:nodejs /app/apps/api/dist ./apps/api/dist
COPY --from=api-builder --chown=eventscrape:nodejs /app/apps/api/package.json ./apps/api/
RUN mkdir -p /worker/src /data/exports /data/backups
COPY --from=api-builder --chown=eventscrape:nodejs /app/worker/src/modules /worker/src/modules
RUN chown -R eventscrape:nodejs /data/exports /data/backups
RUN pnpm install --frozen-lockfile --prod
# Manually build better-sqlite3 native addon
RUN cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && npm run build-release || true
USER eventscrape
EXPOSE 3001
CMD ["node", "apps/api/dist/server.js"]

# Admin Production
FROM node:18-bullseye-slim AS admin
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 eventscrape
RUN npm install -g serve
COPY --from=admin-builder --chown=eventscrape:nodejs /app/apps/admin/dist ./dist
USER eventscrape
EXPOSE 3000
CMD ["serve", "-s", "dist", "-l", "3000"]

# Worker Production
FROM base AS worker
ENV NODE_ENV=production
ENV PLAYWRIGHT_HEADLESS=true
RUN mkdir -p "$PLAYWRIGHT_BROWSERS_PATH" \
    && pnpm exec playwright install --with-deps \
    && pnpm --filter @eventscrape/worker build \
    && test -f worker/dist/worker.js
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 eventscrape \
    && chown -R eventscrape:nodejs "$PLAYWRIGHT_BROWSERS_PATH"
USER eventscrape
CMD ["node", "worker/dist/worker.js"]
