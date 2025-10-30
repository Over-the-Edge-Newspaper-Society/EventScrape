# Quick Fix for Nginx SSL Issue

## What Was the Problem?

The nginx container was crashing because:
1. It was configured to use SSL certificates that don't exist
2. Komodo already has its own reverse proxy with SSL built-in
3. We were running duplicate reverse proxies (both nginx and Komodo)

## Solution Applied

I've **removed the nginx container** from your docker-compose.yml and updated the configuration to use Komodo's built-in reverse proxy instead.

## What You Need to Do Now in Komodo

### Step 1: Configure Komodo's Reverse Proxy

Go to your Komodo Server settings and add these two routes **in this exact order**:

#### Route 1: API (add this FIRST!)
```
Path: /api/*
Target: http://localhost:3001/api/*
SSL: Enabled
```

#### Route 2: Frontend (add this SECOND!)
```
Path: /*
Target: http://localhost:3000/*
SSL: Enabled
```

> ⚠️ **Order matters!** The API route must be configured before the catch-all frontend route.

### Step 2: Redeploy Your Stack

In Komodo or via SSH:

```bash
cd /path/to/EventScrape-1
docker-compose down
docker-compose up -d --build
```

### Step 3: Verify It Works

1. Visit: `https://eventscrape.overtheedgepaper.ca`
   - Should show your dashboard

2. Visit: `https://eventscrape.overtheedgepaper.ca/api/health`
   - Should return JSON like: `{"status":"ok","timestamp":"..."}`

3. Check browser console (F12):
   - Should see no Mixed Content errors
   - API calls should go to `https://eventscrape.overtheedgepaper.ca/api/...`

## Why This Is Better

1. ✅ **No SSL certificate management** - Komodo handles it
2. ✅ **No duplicate reverse proxies** - Simpler architecture
3. ✅ **Fewer containers** - Lower resource usage
4. ✅ **Easier to manage** - All routing in Komodo UI

## If You See the Sidebar on /api/ Routes

This was the original problem - the admin container was responding to API routes instead of the actual API. Once you configure Komodo's reverse proxy correctly, this will be fixed.

## Architecture

**Before (broken):**
```
Browser → Komodo ??? → Admin container (showed sidebar on /api/)
```

**After (fixed):**
```
Browser → Komodo Reverse Proxy ─┬→ /api/* → API container (port 3001)
                                  └→ /*     → Admin container (port 3000)
```

## Need Help?

Check the full guide in `KOMODO_CONFIG.md` for:
- Complete environment variable list
- Troubleshooting common issues
- Testing procedures
- CORS configuration

## Quick Rollback

If something goes wrong, you can temporarily access services directly:
- API: `http://YOUR_SERVER_IP:3001/api/health`
- Frontend: `http://YOUR_SERVER_IP:3000`

But you'll need the reverse proxy configured for production use with HTTPS.
