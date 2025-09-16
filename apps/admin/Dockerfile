FROM node:18-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Debug: List files in build context
RUN ls -la /

# Copy root package.json and pnpm-workspace.yaml
COPY package.json pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./

# Debug: Check what was copied
RUN ls -la ./ && echo "--- apps directory ---" && ls -la apps/ || echo "apps directory not found"

# Copy package.json files
COPY apps/admin/package.json ./apps/admin/

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
RUN pnpm --filter @eventscrape/admin build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 eventscrape

# Install serve for serving static files
RUN npm install -g serve

# Copy the built application
COPY --from=builder --chown=eventscrape:nodejs /app/apps/admin/dist ./dist

USER eventscrape

EXPOSE 3000

ENV PORT 3000

CMD ["serve", "-s", "dist", "-l", "3000"]