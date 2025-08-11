FROM node:18-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy root package.json and pnpm-workspace.yaml
COPY package.json pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./

# Copy package.json files
COPY apps/api/package.json ./apps/api/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build the application
RUN pnpm --filter @eventscrape/api build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 eventscrape

# Copy the built application
COPY --from=builder --chown=eventscrape:nodejs /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=eventscrape:nodejs /app/apps/api/package.json ./apps/api/
COPY --from=builder --chown=eventscrape:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=eventscrape:nodejs /app/package.json ./

USER eventscrape

EXPOSE 3001

ENV PORT 3001

CMD ["node", "apps/api/dist/server.js"]