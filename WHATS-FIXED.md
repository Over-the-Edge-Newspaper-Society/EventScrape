# What Was Fixed - EventScrape Nginx Setup

## The Original Problem

When you visited `https://eventscrape.overtheedgepaper.ca/api/`, you saw:
```html
<html>
  <div class="sidebar">...</div>  <!-- This shouldn't be here! -->
</html>
```

Instead of JSON like:
```json
{"status": "ok"}
```

## Why It Happened

Your setup was:
```
Browser → Komodo → ??? → Admin container (showed sidebar for /api/)
```

The admin container's `serve -s` command was serving the frontend HTML for ALL routes, including `/api/`.

## The Fix

Now you have nginx properly routing requests:

```
Browser → Nginx Container (port 80)
            ├─→ /api/*  → API Container     ✅ Returns JSON
            └─→ /*      → Admin Container   ✅ Returns HTML
```

## What Changed

### 1. Docker Compose Structure

**Before:**
```yaml
api:
  ports:
    - "3001:3001"  # Exposed directly

admin:
  ports:
    - "3000:3000"  # Exposed directly

# No nginx service
```

**After:**
```yaml
api:
  expose:
    - "3001"  # Internal only

admin:
  expose:
    - "3000"  # Internal only

nginx:
  ports:
    - "80:80"  # Only nginx is exposed
  volumes:
    - ./nginx-local.conf:/etc/nginx/nginx.conf:ro
  networks:
    eventscrape:
      aliases:
        - nginx
```

### 2. New Files Created

1. **`nginx-local.conf`** - HTTP config for local/development
   - Serves everything on port 80
   - Routes `/api/*` to API backend
   - Routes `/*` to admin frontend

2. **`nginx-ssl.conf`** - HTTPS config for production (renamed from `nginx.conf`)
   - Includes SSL certificate setup
   - Redirects HTTP to HTTPS
   - For production use with domain

3. **`NGINX-SETUP.md`** - Complete nginx configuration guide

4. **`QUICK-START.md`** - Get running in 5 minutes

5. **`WHATS-FIXED.md`** - This file!

### 3. Network Configuration

**Fixed nginx network config** to match other services:

```yaml
networks:
  eventscrape:
    aliases:
      - nginx  # Now nginx can be reached by name
```

All services now on the same Docker network and can communicate internally.

## How to Use It

### Local Development

```bash
# 1. Start everything
docker-compose up -d

# 2. Access via:
http://localhost/              # Frontend
http://localhost/api/health    # API

# Or add to /etc/hosts:
echo "127.0.0.1  eventscrape.local" | sudo tee -a /etc/hosts

# Then use:
http://eventscrape.local/
http://eventscrape.local/api/health
```

### Production on Komodo

**Option A: Use this nginx (with SSL)**

1. Place SSL certificates in `ssl/` directory
2. Update docker-compose.yml to use `nginx-ssl.conf`
3. Deploy!

See `NGINX-SETUP.md` for details.

**Option B: Use Komodo's reverse proxy**

1. Configure Komodo to route:
   - `/api/*` → `http://localhost:3001/api/*`
   - `/*` → `http://localhost:3000/*`
2. Expose ports 3000 and 3001 in docker-compose
3. Remove nginx service

See `KOMODO_CONFIG.md` for details.

## Testing the Fix

### Before (broken):
```bash
curl https://eventscrape.overtheedgepaper.ca/api/sources
# Returns HTML with <div class="sidebar">
```

### After (fixed):
```bash
curl http://localhost/api/sources
# Returns JSON: [{"id":1,"name":"..."}]

curl http://localhost/
# Returns HTML (frontend)

curl http://localhost/api/health
# Returns JSON: {"status":"ok"}
```

## Key Benefits

✅ **Single unified domain** - Everything on one address
✅ **Proper routing** - API returns JSON, frontend returns HTML
✅ **Portable** - Works locally and in production
✅ **Flexible** - Can use with or without SSL
✅ **Clean URLs** - No port numbers in URLs

## Architecture Comparison

### Before (Problem):
```
Browser
   ↓
Direct port access
   ├─→ :3000 → Admin (serves everything as HTML)
   └─→ :3001 → API (not accessible through domain)
```

### After (Fixed):
```
Browser
   ↓
Nginx (:80 or :443)
   ├─→ /api/* → API Container → JSON responses ✅
   └─→ /*     → Admin Container → HTML responses ✅
```

## Environment Variables

Make sure you're using relative paths in your `.env`:

```bash
# ✅ Correct (for nginx)
VITE_API_URL=/api
ADMIN_API_URL=/api

# ❌ Wrong (hardcoded addresses)
VITE_API_URL=http://10.70.20.171:3001/api
```

With relative paths, nginx can properly proxy requests:
- Browser requests: `http://eventscrape.local/api/health`
- Nginx proxies to: `http://api:3001/api/health`
- Returns: JSON

## Files Reference

- **`docker-compose.yml`** - Main orchestration (updated)
- **`nginx-local.conf`** - HTTP config for development ⭐ Currently active
- **`nginx-ssl.conf`** - HTTPS config for production
- **`.env`** - Environment variables (needs VITE_API_URL=/api)
- **`QUICK-START.md`** - Quick setup guide
- **`NGINX-SETUP.md`** - Full nginx documentation
- **`KOMODO_CONFIG.md`** - Komodo deployment guide

## Quick Commands

```bash
# Start with nginx
docker-compose up -d

# Check it's working
curl http://localhost/api/health

# View nginx logs
docker logs eventscrape-nginx

# Restart nginx only
docker-compose restart nginx

# Rebuild everything
docker-compose down
docker-compose up -d --build

# Stop everything
docker-compose down
```

## What This Solves

- ✅ API endpoints return proper JSON (not HTML)
- ✅ Single domain for all services
- ✅ No port numbers in URLs
- ✅ Proper SSL support (with nginx-ssl.conf)
- ✅ Works locally and in production
- ✅ Clean, maintainable setup

## Next Steps

1. **Test locally:**
   ```bash
   docker-compose up -d
   curl http://localhost/api/health
   ```

2. **Add local domain (optional):**
   ```bash
   sudo nano /etc/hosts
   # Add: 127.0.0.1  eventscrape.local
   ```

3. **Deploy to production:**
   - Follow `NGINX-SETUP.md` for SSL setup
   - Or use `KOMODO_CONFIG.md` for Komodo

---

**Problem solved!** 🎉 Your API now properly returns JSON instead of HTML.
