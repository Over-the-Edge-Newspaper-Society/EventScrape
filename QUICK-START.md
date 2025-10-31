# EventScrape Quick Start Guide

Get EventScrape running with nginx on a single unified domain in 5 minutes.

## Prerequisites

- Docker and Docker Compose installed
- Default host ports 80 (configurable via `EVENTSCRAPE_HTTP_PORT`), 5432, and 6379 available

## Quick Start (localhost)

```bash
# 1. Clone and enter directory
cd /path/to/EventScrape-1

# 2. Create environment file
cat > .env << 'EOF'
# Database
DATABASE_URL=postgres://eventscrape:eventscrape_dev@postgres:5432/eventscrape

# Redis
REDIS_URL=redis://redis:6379

# API Settings
NODE_ENV=production
PORT=3001

# Host HTTP port (change if 80 is busy)
EVENTSCRAPE_HTTP_PORT=80

# IMPORTANT: Use relative path for nginx proxying
VITE_API_URL=/api
ADMIN_API_URL=/api

# Worker Settings
PLAYWRIGHT_HEADLESS=true
EXPORT_DIR=/data/exports

# CORS - localhost for development
CORS_ALLOWED_ORIGINS=http://localhost,http://eventscrape.local

# Storage directories
INSTAGRAM_IMAGES_DIR=/data/instagram_images
BACKUP_DIR=/data/backups

# API URL for worker (internal Docker network)
API_URL=http://api:3001
EOF

# 3. Start everything
docker-compose up -d

# 4. Wait for services to be ready (about 30 seconds)
echo "Waiting for services to start..."
sleep 30

# 5. Check everything is running
docker-compose ps
```

## Access Your Application

Once running, open your browser:

- **Frontend:** http://localhost/
- **API Health:** http://localhost/api/health
- **API Sources:** http://localhost/api/sources

If you changed `EVENTSCRAPE_HTTP_PORT`, replace `localhost` with `localhost:<your-port>`.

You should see the EventScrape dashboard!

## Add Local Domain (Optional but Recommended)

For a cleaner URL like `http://eventscrape.local`:

### On Mac/Linux:
```bash
echo "127.0.0.1  eventscrape.local" | sudo tee -a /etc/hosts
```

### On Windows (as Administrator):
```powershell
Add-Content -Path C:\Windows\System32\drivers\etc\hosts -Value "127.0.0.1  eventscrape.local"
```

Then access via:
- http://eventscrape.local/
- http://eventscrape.local/api/health

## Verify Everything Works

```bash
# Test nginx is serving
curl -I http://localhost/

# Test API endpoint
curl http://localhost/api/health

# Check all containers are healthy
docker-compose ps

# View logs if something's wrong
docker-compose logs nginx
docker-compose logs api
docker-compose logs admin
```

Expected responses:

```bash
# Nginx should return 200
curl -I http://localhost/
# HTTP/1.1 200 OK

# API should return JSON
curl http://localhost/api/health
# {"status":"ok","timestamp":"2025-10-30T..."}

# All containers should show "Up" status
docker-compose ps
# NAME                    STATUS
# eventscrape-admin       Up
# eventscrape-api         Up
# eventscrape-nginx       Up
# eventscrape-postgres    Up (healthy)
# eventscrape-redis       Up (healthy)
# eventscrape-worker      Up
```

## Architecture Overview

```
Your Browser
   ↓
http://localhost/ (or http://eventscrape.local/)
   ↓
Nginx Container (port 80 inside container)
   ├─→ /api/*  → API Container (port 3001)    [Backend API]
   └─→ /*      → Admin Container (port 3000)  [Frontend UI]
         ↓
   PostgreSQL + Redis
```

> Host traffic lands on the port defined by `EVENTSCRAPE_HTTP_PORT` (defaults to 80) before nginx proxies to the internal services.

## Common Issues

### Port 80 already in use

```bash
# Find what's using port 80
sudo lsof -i :80

# Stop the conflicting service (example: Apache)
sudo systemctl stop apache2

# Or set a different host port in .env (then restart):
EVENTSCRAPE_HTTP_PORT=8080

# Access via http://localhost:8080/
```

### Nginx container keeps restarting

```bash
# Check nginx logs
docker logs eventscrape-nginx

# Most common: missing config file
ls -la nginx-local.conf

# Test nginx config
docker exec eventscrape-nginx nginx -t
```

### API returns HTML instead of JSON

This means routing is wrong. Check:

```bash
# Verify nginx config location order
grep -A 5 "location" nginx-local.conf

# Should show /api/ BEFORE /
# location /api/ { ... }
# location / { ... }

# Restart nginx
docker-compose restart nginx
```

### Database connection errors

```bash
# Check postgres is healthy
docker-compose ps postgres

# View postgres logs
docker logs eventscrape-postgres

# Wait longer for initialization
sleep 60
docker-compose ps
```

## Stopping the Application

```bash
# Stop all containers
docker-compose down

# Stop and remove volumes (fresh start)
docker-compose down -v

# Stop and remove everything including images
docker-compose down -v --rmi all
```

## Rebuilding After Changes

```bash
# Rebuild specific service
docker-compose build api
docker-compose up -d api

# Rebuild everything
docker-compose down
docker-compose build --no-cache
docker-compose up -d

# Force rebuild admin (if frontend changes aren't showing)
docker-compose build --no-cache admin
docker-compose up -d --force-recreate admin
```

## Environment-Specific Configs

### Development (current setup)
- Uses `nginx-local.conf` (HTTP only)
- Port 80 exposed
- No SSL

### Production with SSL
See `NGINX-SETUP.md` for instructions on:
- Using `nginx-ssl.conf`
- Adding SSL certificates
- Exposing port 443
- Using your production domain

## Next Steps

1. ✅ Application is running at http://localhost/
2. Configure scraping sources at http://localhost/sources
3. View events at http://localhost/events
4. Check runs at http://localhost/runs
5. Monitor queue at http://localhost/api/queue/status

## Need Help?

- **Full nginx guide:** See `NGINX-SETUP.md`
- **Komodo deployment:** See `KOMODO_CONFIG.md`
- **Architecture details:** See `README.md`
- **Check logs:** `docker-compose logs -f [service]`

## Production Deployment

For Komodo or other production servers:

1. **Option A:** Use this nginx setup with SSL
   - Follow `NGINX-SETUP.md` - Setup Option 3
   - Use `nginx-ssl.conf`
   - Add SSL certificates

2. **Option B:** Use Komodo's reverse proxy
   - Follow `KOMODO_CONFIG.md`
   - Remove nginx service
   - Configure in Komodo UI

Both options work - choose based on your preference!

---

**You're all set!** 🎉 Visit http://localhost/ to start using EventScrape.
