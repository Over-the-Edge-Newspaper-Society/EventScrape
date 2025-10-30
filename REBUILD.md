# Rebuild Instructions for Admin Container

## Problem
The admin container currently has an old build with hardcoded API URLs (`http://10.70.20.171:3001`). This causes "Mixed Content" errors in HTTPS.

## Solution
Rebuild the admin container with the updated configuration that uses relative paths (`/api`).

## Steps to Rebuild on Server

### 1. Pull Latest Changes
```bash
cd /path/to/EventScrape-1
git pull origin main
```

### 2. Force Rebuild Admin Container
```bash
# Stop the admin container
docker-compose -f docker-compose.prod.yml stop admin

# Remove the old admin image (force rebuild)
docker-compose -f docker-compose.prod.yml rm -f admin
docker rmi eventscrape-1-admin || true

# Rebuild admin with no cache
docker-compose -f docker-compose.prod.yml build --no-cache admin

# Start the admin container
docker-compose -f docker-compose.prod.yml up -d admin
```

### 3. Verify the Build
```bash
# Check that admin is running
docker-compose -f docker-compose.prod.yml ps admin

# Check the logs
docker-compose -f docker-compose.prod.yml logs admin

# Verify the API URL in the built bundle
docker-compose -f docker-compose.prod.yml exec admin sh -c "grep -o 'http://[^\"]*3001[^\"]*' /app/dist/assets/*.js | head -5"
```
The last command should return NO results. If it finds any URLs with `3001`, the old build is still being used.

### 4. Test in Browser
1. Visit `https://eventscrape.overtheedgepaper.ca`
2. Open browser DevTools → Console
3. Run: `console.log(window.API_BASE_URL || 'checking...')`
4. Check Network tab - API calls should go to `https://eventscrape.overtheedgepaper.ca/api/...`
5. Should see NO "Mixed Content" errors

## If Problems Persist

### Check Build Arguments
Verify the build is using the correct VITE_API_URL:

```bash
# Check what environment variables are available during build
docker-compose -f docker-compose.prod.yml build --progress=plain admin 2>&1 | grep VITE_API_URL
```

### Manual Build Test
Build manually to see detailed output:

```bash
cd /path/to/EventScrape-1
docker build \
  -f apps/admin/Dockerfile \
  --build-arg VITE_API_URL=/api \
  --progress=plain \
  --no-cache \
  -t eventscrape-admin-test \
  .
```

### Check .env Files
Make sure no `.env` file on the server has old values:

```bash
grep -r "VITE_API_URL" .env* 2>/dev/null
```

Should show:
```
.env.docker:VITE_API_URL=/api
```

### Nuclear Option - Full Rebuild
If nothing works, rebuild everything:

```bash
docker-compose -f docker-compose.prod.yml down
docker system prune -a -f
docker-compose -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.prod.yml up -d
```

## What Changed

1. **`.env.docker`**: Changed `VITE_API_URL` from `http://localhost:3001/api` to `/api`
2. **`apps/admin/Dockerfile`**: Added `ARG` and `ENV` for `VITE_API_URL` with default `/api`
3. **`apps/admin/src/pages/Exports.tsx`**: Removed hardcoded API URL
4. **`apps/api/src/db/migrate.ts`**: Added migrations 0018 and 0019

## Expected Result

After rebuilding:
- ✅ No "Mixed Content" errors in browser console
- ✅ API calls use `https://eventscrape.overtheedgepaper.ca/api/...`
- ✅ No hardcoded `http://10.70.20.171:3001` URLs
- ✅ Frontend and API communicate through nginx
