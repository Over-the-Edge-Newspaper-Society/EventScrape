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
COPY worker/package.json ./worker/

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
RUN pnpm --filter @eventscrape/worker build

# Production image, copy all the files and run worker
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 eventscrape

# Install Playwright dependencies in production
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Tell Playwright to use installed Chromium
ENV PLAYWRIGHT_BROWSERS_PATH=0
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copy the built application
COPY --from=builder --chown=eventscrape:nodejs /app/worker/dist ./worker/dist
COPY --from=builder --chown=eventscrape:nodejs /app/worker/package.json ./worker/
COPY --from=builder --chown=eventscrape:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=eventscrape:nodejs /app/package.json ./

USER eventscrape

CMD ["node", "worker/dist/worker.js"]