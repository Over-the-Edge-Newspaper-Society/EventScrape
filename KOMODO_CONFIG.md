# Komodo Deployment Configuration

This guide explains how to deploy EventScrape on Komodo using Komodo's built-in reverse proxy with SSL.

## Quick Setup (Step-by-Step)

### Step 1: Configure Komodo Reverse Proxy

In Komodo's Server settings, add two routes:

**Route 1: API (configure this FIRST!)**
- Path: `/api/*`
- Target: `http://localhost:3001/api/*`
- SSL: Enabled (Komodo will handle HTTPS)

**Route 2: Frontend (configure this SECOND!)**
- Path: `/*`
- Target: `http://localhost:3000/*`
- SSL: Enabled (Komodo will handle HTTPS)

> **Note:** Route order matters! API route must come before the catch-all frontend route.

### Step 2: Set Environment Variables in Komodo

Update your stack's environment variables (see section below for complete list).

### Step 3: Deploy

```bash
docker-compose down
docker-compose up -d --build
```

## Environment Variables for HTTPS Deployment

When using Komodo's reverse proxy with HTTPS, use these environment variables:

### Updated Configuration

```bash
# Database
DATABASE_URL=postgres://eventscrape:eventscrape_dev@postgres:5432/eventscrape

# Redis
REDIS_URL=redis://redis:6379

# API Settings
NODE_ENV=production
PORT=3001

# IMPORTANT: Frontend API URL - use relative path for nginx proxying
VITE_API_URL=/api

# Build argument (same as VITE_API_URL)
ADMIN_API_URL=/api

# Worker Settings
PLAYWRIGHT_HEADLESS=true
EXPORT_DIR=/data/exports

# CORS - add your domain
CORS_ALLOWED_ORIGINS=https://eventscrape.overtheedgepaper.ca,http://localhost:3000

# Instagram/Backup directories (if using)
INSTAGRAM_IMAGES_DIR=/data/instagram_images
BACKUP_DIR=/data/backups

# API URL for worker (internal Docker network)
API_URL=http://api:3001
```

## Key Changes Explained

### 1. VITE_API_URL
**Before:** `http://10.70.20.171:3001/api`
**After:** `/api`

**Why:** Using a relative path allows nginx to proxy requests. The browser will automatically use `https://eventscrape.overtheedgepaper.ca/api/...` based on the current page origin.

### 2. ADMIN_API_URL
**Before:** `http://10.70.20.171:3001/api`
**After:** `/api`

**Why:** This is used as a build argument in the Dockerfile. Must match VITE_API_URL.

### 3. CORS_ALLOWED_ORIGINS
**Before:** `http://10.70.20.171:3000,http://localhost:3000`
**After:** `https://eventscrape.overtheedgepaper.ca,http://localhost:3000`

**Why:** The API needs to allow CORS requests from your HTTPS domain. Keep `localhost:3000` for local development.

## Port Configuration

### In Komodo Stack Configuration

**Admin Service:**
- **Expose port:** `3000:3000`
- Komodo's reverse proxy will route traffic to this port

**API Service:**
- **Expose port:** `3001:3001`
- Komodo's reverse proxy will route traffic to this port

Example docker-compose ports configuration:
```yaml
services:
  api:
    ports:
      - "3001:3001"

  admin:
    ports:
      - "3000:3000"
```

> **Note:** Komodo handles SSL termination, so your containers only need to expose HTTP ports.

## Komodo Deployment Steps

### 1. Update Environment Variables in Komodo
In your Komodo dashboard:
1. Go to your EventScrape stack/deployment
2. Find the Environment Variables section
3. Update the values as shown above
4. Save changes

### 2. Update Build Args (if separate)
Some Komodo setups separate build args from runtime env vars:
- Set `VITE_API_URL=/api` as a **build argument** for the admin service
- This ensures it's available during the Vite build process

### 3. Rebuild and Redeploy
In Komodo:
1. Stop the stack
2. Select "Rebuild" or "Build from scratch" (not just restart)
3. This forces a fresh build with new environment variables
4. Deploy the stack

### 4. Verify Deployment
```bash
# SSH into your server and run:

# Check services are running
docker-compose ps

# Check admin container environment
docker exec eventscrape-admin env | grep VITE_API_URL

# Check if hardcoded URLs still exist (should return nothing)
docker exec eventscrape-admin sh -c "grep -o 'http://10\\.70\\.20\\.171' /app/dist/assets/*.js | head -5"

# Test API health endpoint
curl http://localhost:3001/api/health

# Check logs
docker logs eventscrape-api
docker logs eventscrape-admin
```

## Common Komodo Issues

### Issue 1: Environment Variables Not Applied
**Symptom:** Still seeing `http://10.70.20.171:3001/api` in browser

**Solution:**
- Ensure you're updating the **build environment variables**, not just runtime
- Force rebuild: `docker-compose build --no-cache admin`
- In Komodo, use "Rebuild" not "Restart"

### Issue 2: VITE_API_URL Not Available During Build
**Symptom:** Frontend still has fallback `http://localhost:3001/api`

**Solution:**
- Set `VITE_API_URL=/api` as a **build argument** in Komodo
- Dockerfile needs: `ARG VITE_API_URL=/api` (already added)
- Build process: `ENV VITE_API_URL=$VITE_API_URL` (already added)

### Issue 3: CORS Errors
**Symptom:** Browser shows CORS errors from `https://eventscrape.overtheedgepaper.ca`

**Solution:**
- Update `CORS_ALLOWED_ORIGINS` to include `https://eventscrape.overtheedgepaper.ca`
- Restart API container after changing CORS settings

## Architecture with Komodo Reverse Proxy

```
Internet
   ↓ (HTTPS :443)
Komodo Reverse Proxy
   ├─→ / → Admin (localhost:3000) - Frontend
   └─→ /api/ → API (localhost:3001) - Backend
          ↓
    ┌─────┴─────┐
    ↓           ↓
PostgreSQL   Redis
```

## Komodo Reverse Proxy Configuration

In Komodo, configure your server to route:

1. **Frontend (Admin) Routes:**
   - Source: `https://eventscrape.overtheedgepaper.ca/*`
   - Target: `http://localhost:3000/*`
   - Protocol: HTTP → HTTPS (Komodo handles SSL)

2. **API Routes:**
   - Source: `https://eventscrape.overtheedgepaper.ca/api/*`
   - Target: `http://localhost:3001/api/*`
   - Protocol: HTTP → HTTPS (Komodo handles SSL)

**Important:** The API route must be configured BEFORE the frontend route (order matters!)

## Testing After Deployment

1. **Visit your site:** `https://eventscrape.overtheedgepaper.ca`
2. **Open DevTools Console:** Should show no Mixed Content errors
3. **Check Network Tab:** API calls should go to `https://eventscrape.overtheedgepaper.ca/api/...`
4. **Test API directly:** `https://eventscrape.overtheedgepaper.ca/api/health`

## Rollback (if needed)

If something breaks, you can temporarily rollback:

```bash
# In Komodo or via SSH:
VITE_API_URL=http://10.70.20.171:3001/api
ADMIN_API_URL=http://10.70.20.171:3001/api
```

Then rebuild admin container. But this will bring back the Mixed Content errors.

## Complete Komodo Environment Template

```env
# PostgreSQL
DATABASE_URL=postgres://eventscrape:YOUR_PASSWORD@postgres:5432/eventscrape
POSTGRES_PASSWORD=YOUR_PASSWORD

# Redis
REDIS_URL=redis://redis:6379

# API
NODE_ENV=production
PORT=3001
CORS_ALLOWED_ORIGINS=https://eventscrape.overtheedgepaper.ca,http://localhost:3000

# Admin Frontend (CRITICAL - use relative path)
VITE_API_URL=/api
ADMIN_API_URL=/api

# Worker
PLAYWRIGHT_HEADLESS=true
EXPORT_DIR=/data/exports
API_URL=http://api:3001

# Storage
INSTAGRAM_IMAGES_DIR=/data/instagram_images
BACKUP_DIR=/data/backups
RATE_LIMIT_PER_MIN=60
```

Save this configuration in Komodo and rebuild your stack.
