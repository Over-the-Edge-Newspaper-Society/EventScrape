# Multi-stage build for EventScrape services
FROM node:18-alpine AS base

# Install system dependencies
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy all app package.json files
COPY apps/api/package.json ./apps/api/
COPY apps/admin/package.json ./apps/admin/
COPY worker/package.json ./worker/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build API
FROM base AS api-builder
RUN pnpm --filter @eventscrape/api build

# Build Admin
FROM base AS admin-builder
RUN pnpm --filter @eventscrape/admin build

# API Production
FROM node:18-alpine AS api
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 eventscrape
RUN npm install -g pnpm
COPY --from=api-builder --chown=eventscrape:nodejs /app/package.json ./
COPY --from=api-builder --chown=eventscrape:nodejs /app/pnpm-workspace.yaml ./
COPY --from=api-builder --chown=eventscrape:nodejs /app/pnpm-lock.yaml ./
COPY --from=api-builder --chown=eventscrape:nodejs /app/apps/api/dist ./apps/api/dist
COPY --from=api-builder --chown=eventscrape:nodejs /app/apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile --prod
USER eventscrape
EXPOSE 3001
CMD ["node", "apps/api/dist/server.js"]

# Admin Production
FROM node:18-alpine AS admin
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
RUN pnpm --filter @eventscrape/worker build
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 eventscrape
USER eventscrape
CMD ["node", "worker/dist/index.js"]