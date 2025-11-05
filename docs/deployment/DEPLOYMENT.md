# Deployment Guide

This guide explains how to deploy EventScrape with HTTPS support using nginx reverse proxy.

## Overview

The production setup includes:
- **Nginx**: Reverse proxy handling HTTPS and routing
- **Frontend (Admin)**: Served at `https://yourdomain.com/`
- **Backend (API)**: Accessible at `https://yourdomain.com/api/`
- All services communicate internally via Docker network

## Prerequisites

1. A domain name pointing to your server (e.g., `eventscrape.overtheedgepaper.ca`)
2. Docker and Docker Compose installed
3. Ports 80 and 443 open on your firewall

## SSL Certificate Setup

### Option 1: Using Let's Encrypt (Recommended)

1. **Initial Setup with Self-Signed Certificate (for testing)**
   ```bash
   mkdir -p ssl
   openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
     -keyout ssl/privkey.pem \
     -out ssl/fullchain.pem \
     -subj "/CN=eventscrape.overtheedgepaper.ca"
   ```

2. **Get Let's Encrypt Certificate**
   ```bash
   # Install certbot
   sudo apt-get update
   sudo apt-get install certbot

   # Stop nginx temporarily
   docker-compose -f docker-compose.prod.yml stop nginx

   # Get certificate
   sudo certbot certonly --standalone \
     -d eventscrape.overtheedgepaper.ca \
     --email your-email@example.com \
     --agree-tos

   # Copy certificates to ssl directory
   sudo cp /etc/letsencrypt/live/eventscrape.overtheedgepaper.ca/fullchain.pem ssl/
   sudo cp /etc/letsencrypt/live/eventscrape.overtheedgepaper.ca/privkey.pem ssl/
   sudo chown $USER:$USER ssl/*.pem

   # Restart nginx
   docker-compose -f docker-compose.prod.yml start nginx
   ```

3. **Auto-renewal Setup**
   Add to crontab:
   ```bash
   0 0 * * 0 certbot renew --quiet && cp /etc/letsencrypt/live/eventscrape.overtheedgepaper.ca/*.pem /path/to/eventscrape/ssl/ && docker-compose -f docker-compose.prod.yml restart nginx
   ```

### Option 2: Using Existing Certificates

Copy your certificate files to the `ssl` directory:
```bash
mkdir -p ssl
cp /path/to/fullchain.pem ssl/
cp /path/to/privkey.pem ssl/
```

## Deployment Steps

1. **Set Environment Variables**

   Create a `.env` file in the project root:
   ```bash
   POSTGRES_PASSWORD=your_secure_password_here
   ```

2. **Build and Start Services**
   ```bash
   docker-compose -f docker-compose.prod.yml build
   docker-compose -f docker-compose.prod.yml up -d
   ```

3. **Verify Deployment**
   ```bash
   # Check all services are running
   docker-compose -f docker-compose.prod.yml ps

   # Check nginx logs
   docker-compose -f docker-compose.prod.yml logs nginx

   # Check API logs
   docker-compose -f docker-compose.prod.yml logs api
   ```

4. **Test HTTPS Access**
   - Visit `https://eventscrape.overtheedgepaper.ca`
   - Check browser console for any mixed content errors
   - Verify API calls are going to `https://eventscrape.overtheedgepaper.ca/api/`

## Architecture

```
Internet (HTTPS)
       ↓
   Nginx :443
       ↓
   ┌───────────────┬────────────────┐
   │               │                │
   ↓               ↓                ↓
Admin:3000     API:3001       Worker
   │               │                │
   └───────────────┴────────────────┘
                   ↓
          ┌────────┴────────┐
          ↓                 ↓
     PostgreSQL:5432    Redis:6379
```

## Troubleshooting

### Mixed Content Errors

If you see "Mixed Content" errors in the browser console:

1. **Check the API URL in browser console**:
   - Open DevTools → Console
   - Run: `console.log(window.location.origin)`
   - API calls should use the same origin

2. **Verify nginx is routing correctly**:
   ```bash
   docker-compose -f docker-compose.prod.yml logs nginx | grep api
   ```

3. **Check the built frontend**:
   ```bash
   docker-compose -f docker-compose.prod.yml exec admin cat /app/dist/assets/index-*.js | grep -o 'http://[^"]*' | head -5
   ```
   - Should NOT see any `http://10.70.20.171` or `http://localhost`

### Database Migrations Not Running

If new migrations aren't being applied:

1. Check API logs:
   ```bash
   docker-compose -f docker-compose.prod.yml logs api | grep -i migration
   ```

2. Manually run migrations:
   ```bash
   docker-compose -f docker-compose.prod.yml exec api node dist/db/migrate.js
   ```

### SSL Certificate Issues

1. **Certificate not found**:
   ```bash
   ls -la ssl/
   # Should show fullchain.pem and privkey.pem
   ```

2. **Permission denied**:
   ```bash
   sudo chown -R $USER:$USER ssl/
   chmod 644 ssl/*.pem
   ```

## Updating the Application

1. **Pull latest changes**:
   ```bash
   git pull
   ```

2. **Rebuild and restart**:
   ```bash
   docker-compose -f docker-compose.prod.yml build
   docker-compose -f docker-compose.prod.yml up -d
   ```

3. **Check migrations ran**:
   ```bash
   docker-compose -f docker-compose.prod.yml logs api | grep -i migration
   ```

## Security Notes

1. **Change default passwords** in `.env` file
2. **Keep SSL certificates up to date** (Let's Encrypt expires every 90 days)
3. **Regularly update Docker images**:
   ```bash
   docker-compose -f docker-compose.prod.yml pull
   docker-compose -f docker-compose.prod.yml up -d
   ```
4. **Monitor logs** for suspicious activity:
   ```bash
   docker-compose -f docker-compose.prod.yml logs -f nginx
   ```

## Maintenance

### Backup Database

```bash
docker-compose -f docker-compose.prod.yml exec postgres pg_dump -U eventscrape eventscrape > backup_$(date +%Y%m%d).sql
```

### Restore Database

```bash
cat backup_20241030.sql | docker-compose -f docker-compose.prod.yml exec -T postgres psql -U eventscrape eventscrape
```

### View Logs

```bash
# All services
docker-compose -f docker-compose.prod.yml logs -f

# Specific service
docker-compose -f docker-compose.prod.yml logs -f api
docker-compose -f docker-compose.prod.yml logs -f nginx
docker-compose -f docker-compose.prod.yml logs -f worker
```
