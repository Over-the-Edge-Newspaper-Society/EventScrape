# Nginx Setup Guide

This guide explains how to use nginx to serve your entire EventScrape application on a single unified domain/port.

## Overview

Instead of accessing services on different ports:
- ❌ `http://localhost:3000` (frontend)
- ❌ `http://localhost:3001` (API)

Everything is served through nginx on one unified address:
- ✅ `http://eventscrape.local/` (frontend)
- ✅ `http://eventscrape.local/api/` (API)

Or simply:
- ✅ `http://localhost/` (frontend)
- ✅ `http://localhost/api/` (API)

## Configuration Files

This repo includes two nginx configurations:

1. **`nginx-local.conf`** - For local development (HTTP only, no SSL)
2. **`nginx-ssl.conf`** - For production with SSL/HTTPS (requires certificates)

The docker-compose.yml is currently set to use `nginx-local.conf`.

## Setup Option 1: Use localhost (Easiest)

This is the simplest option - no DNS setup needed.

### Step 1: Start the stack

```bash
docker-compose up -d
```

### Step 2: Access the application

- Frontend: http://localhost/
- API: http://localhost/api/health

That's it! Everything works through nginx on port 80.

## Setup Option 2: Use eventscrape.local (Better for Development)

Using a local domain name is cleaner and more production-like.

### Step 1: Add to /etc/hosts

```bash
# On Mac/Linux:
sudo nano /etc/hosts

# Add this line:
127.0.0.1  eventscrape.local

# Save and exit (Ctrl+X, then Y, then Enter)
```

```powershell
# On Windows (run as Administrator):
notepad C:\Windows\System32\drivers\etc\hosts

# Add this line:
127.0.0.1  eventscrape.local

# Save and close
```

### Step 2: Start the stack

```bash
docker-compose up -d
```

### Step 3: Access the application

- Frontend: http://eventscrape.local/
- API: http://eventscrape.local/api/health

## Setup Option 3: Use SSL/HTTPS for Production (Komodo)

If you're deploying to production with SSL certificates (like on Komodo).

### Step 1: Update docker-compose to use SSL config

Edit `docker-compose.yml`:

```yaml
  nginx:
    image: nginx:alpine
    container_name: eventscrape-nginx
    ports:
      - "80:80"
      - "443:443"  # Add HTTPS port
    volumes:
      - ./nginx-ssl.conf:/etc/nginx/nginx.conf:ro  # Change to SSL config
      - ./ssl:/etc/nginx/ssl:ro  # Add SSL certificates
      - ./certbot/www:/var/www/certbot:ro  # For Let's Encrypt
    depends_on:
      - api
      - admin
    networks:
      - eventscrape
    restart: unless-stopped
```

### Step 2: Place SSL certificates

```bash
# Create ssl directory
mkdir -p ssl

# Copy your certificates
cp /path/to/fullchain.pem ssl/
cp /path/to/privkey.pem ssl/
chmod 644 ssl/*.pem
```

### Step 3: Update nginx-ssl.conf

Edit the `server_name` in `nginx-ssl.conf`:

```nginx
server_name eventscrape.overtheedgepaper.ca;  # Change to your domain
```

### Step 4: Deploy

```bash
docker-compose down
docker-compose up -d
```

### Step 5: Access via HTTPS

- Frontend: https://eventscrape.overtheedgepaper.ca/
- API: https://eventscrape.overtheedgepaper.ca/api/health

## Environment Variables

Update your `.env` file to use relative paths for the API:

```bash
# Use relative path so nginx can proxy correctly
VITE_API_URL=/api
ADMIN_API_URL=/api

# For CORS, allow your domain
CORS_ALLOWED_ORIGINS=http://localhost,http://eventscrape.local
```

For production with SSL:
```bash
CORS_ALLOWED_ORIGINS=https://eventscrape.overtheedgepaper.ca
```

## Architecture

```
Browser
   ↓
   http://eventscrape.local/
   ↓
Nginx (port 80)
   ├─→ /api/*  → API Backend (api:3001)
   └─→ /*      → Frontend (admin:3000)
```

With SSL:
```
Browser
   ↓
   https://yourdomain.com/
   ↓
Nginx (port 443)
   ├─→ /api/*  → API Backend (api:3001)
   └─→ /*      → Frontend (admin:3000)
```

## Troubleshooting

### Issue: nginx container keeps restarting

Check the logs:
```bash
docker logs eventscrape-nginx
```

Common causes:
- SSL certificates missing (if using nginx-ssl.conf)
- Port 80 already in use
- Configuration syntax error

Test nginx config:
```bash
docker exec eventscrape-nginx nginx -t
```

### Issue: Getting "Bad Gateway" errors

This usually means nginx can't reach the backend services.

Check if services are running:
```bash
docker-compose ps
```

Check if API is accessible from nginx:
```bash
docker exec eventscrape-nginx wget -O- http://api:3001/api/health
```

### Issue: API returns HTML instead of JSON

This means the nginx routing is incorrect. The `/api/` location block should come BEFORE the `/` location block in the nginx config.

Check your nginx config order:
```nginx
# Correct order:
location /api/ { ... }    # This MUST come first
location / { ... }         # Catch-all comes last
```

### Issue: Can't access eventscrape.local

Check your /etc/hosts:
```bash
# Mac/Linux
cat /etc/hosts | grep eventscrape

# Windows
type C:\Windows\System32\drivers\etc\hosts | findstr eventscrape
```

Should show:
```
127.0.0.1  eventscrape.local
```

Try flushing DNS cache:
```bash
# Mac
sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder

# Windows (run as Admin)
ipconfig /flushdns

# Linux
sudo systemd-resolve --flush-caches
```

## Switching Between Configs

### Switch from local to SSL:

1. Edit `docker-compose.yml`:
   ```yaml
   volumes:
     - ./nginx-ssl.conf:/etc/nginx/nginx.conf:ro
     - ./ssl:/etc/nginx/ssl:ro
   ```

2. Restart:
   ```bash
   docker-compose restart nginx
   ```

### Switch from SSL to local:

1. Edit `docker-compose.yml`:
   ```yaml
   volumes:
     - ./nginx-local.conf:/etc/nginx/nginx.conf:ro
   ```

2. Restart:
   ```bash
   docker-compose restart nginx
   ```

## Testing Your Setup

After starting the stack, test each endpoint:

```bash
# Test nginx is running
curl -I http://localhost/

# Test API through nginx
curl http://localhost/api/health

# Test frontend through nginx
curl http://localhost/ | head -20

# Check nginx is proxying (should see nginx in response)
curl -I http://localhost/api/health | grep -i server
```

## For Komodo Deployments

If you're using Komodo, you have two options:

**Option A: Use this nginx setup**
- Follow "Setup Option 3" above
- Don't configure reverse proxy in Komodo
- Let this nginx container handle everything

**Option B: Use Komodo's built-in reverse proxy**
- Remove the nginx service from docker-compose.yml
- Expose ports 3000 and 3001
- Configure routing in Komodo (see KOMODO_CONFIG.md)

Choose **Option A** if you want full control and portability.
Choose **Option B** if you prefer to manage everything in Komodo's UI.

## Quick Start Summary

For local development:
```bash
# 1. Add to /etc/hosts (optional but recommended)
echo "127.0.0.1  eventscrape.local" | sudo tee -a /etc/hosts

# 2. Create .env file
cat > .env << EOF
VITE_API_URL=/api
ADMIN_API_URL=/api
CORS_ALLOWED_ORIGINS=http://localhost,http://eventscrape.local
EOF

# 3. Start everything
docker-compose up -d

# 4. Open browser
# http://eventscrape.local/
# or http://localhost/
```

That's it! 🎉
