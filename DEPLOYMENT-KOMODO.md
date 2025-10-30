# EventScrape Komodo Deployment Guide

## Prerequisites

1. Komodo server with Docker and Docker Compose installed
2. SSL certificates for your domain (Let's Encrypt recommended)
3. Domain name pointing to your Komodo server

## Directory Structure

```
EventScrape-1/
├── docker-compose.yml          # Production configuration
├── nginx.conf                  # Nginx reverse proxy config
├── ssl/                        # SSL certificates directory
│   ├── fullchain.pem          # SSL certificate
│   └── privkey.pem            # SSL private key
└── certbot/
    └── www/                    # Let's Encrypt challenge directory
```

## Setup Instructions

### 1. Create Required Directories

```bash
mkdir -p ssl certbot/www
```

### 2. Set Up SSL Certificates

#### Option A: Using Let's Encrypt (Recommended)

```bash
# Install certbot if not already installed
sudo apt-get update
sudo apt-get install certbot

# Get certificate (replace with your domain)
sudo certbot certonly --standalone -d eventscrape.overtheedgepaper.ca

# Copy certificates to ssl directory
sudo cp /etc/letsencrypt/live/eventscrape.overtheedgepaper.ca/fullchain.pem ssl/
sudo cp /etc/letsencrypt/live/eventscrape.overtheedgepaper.ca/privkey.pem ssl/
sudo chmod 644 ssl/*.pem
```

#### Option B: Using Existing Certificates

```bash
# Copy your certificates to the ssl directory
cp /path/to/your/fullchain.pem ssl/
cp /path/to/your/privkey.pem ssl/
chmod 644 ssl/*.pem
```

### 3. Configure Environment Variables

Create a `.env` file in the project root:

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

# Instagram/Backup directories
INSTAGRAM_IMAGES_DIR=/data/instagram_images
BACKUP_DIR=/data/backups

# API URL for worker (internal Docker network)
API_URL=http://api:3001
```

### 4. Deploy with Docker Compose

```bash
# Pull latest changes
git pull origin main

# Build and start services
docker-compose down
docker-compose build --no-cache
docker-compose up -d

# Check logs
docker-compose logs -f
```

### 5. Verify Deployment

Check that all services are running:

```bash
docker-compose ps
```

You should see:
- `eventscrape-postgres` (healthy)
- `eventscrape-redis` (healthy)
- `eventscrape-api` (running)
- `eventscrape-admin` (running)
- `eventscrape-worker` (running)
- `eventscrape-nginx` (running)

### 6. Test the Application

1. **Test HTTPS redirect**: Visit http://eventscrape.overtheedgepaper.ca - should redirect to HTTPS
2. **Test frontend**: Visit https://eventscrape.overtheedgepaper.ca - should show the dashboard
3. **Test API**: Visit https://eventscrape.overtheedgepaper.ca/api/health - should return JSON status

## Komodo-Specific Configuration

If you're using Komodo's built-in reverse proxy:

### Option 1: Use Komodo's Reverse Proxy (Recommended)

1. Remove the nginx service from docker-compose.yml
2. Configure Komodo to proxy:
   - `/api/*` → `http://eventscrape-api:3001/api/*`
   - `/*` → `http://eventscrape-admin:3000/*`
3. Enable SSL in Komodo for your domain

### Option 2: Use Included Nginx Service

1. Keep the nginx service in docker-compose.yml
2. Map Komodo's ports 80 and 443 to the nginx container
3. Ensure SSL certificates are mounted correctly

## Troubleshooting

### Issue: API returns HTML instead of JSON

**Symptom**: Accessing `/api/` shows the frontend HTML with sidebar

**Solution**:
1. Verify nginx is running: `docker ps | grep nginx`
2. Check nginx config is mounted: `docker exec eventscrape-nginx cat /etc/nginx/nginx.conf`
3. Verify API routes: `docker exec eventscrape-api wget -O- http://localhost:3001/api/health`
4. Check nginx logs: `docker logs eventscrape-nginx`

### Issue: SSL Certificate Errors

**Solution**:
```bash
# Verify certificate files exist
ls -l ssl/

# Check certificate validity
openssl x509 -in ssl/fullchain.pem -text -noout

# Restart nginx
docker-compose restart nginx
```

### Issue: Services Not Starting

**Solution**:
```bash
# Check service logs
docker-compose logs api
docker-compose logs admin
docker-compose logs worker

# Verify database migrations
docker exec eventscrape-api node apps/api/dist/server.js

# Check database connection
docker exec eventscrape-postgres psql -U eventscrape -d eventscrape -c '\dt'
```

## Updating the Application

```bash
# Pull latest changes
git pull origin main

# Rebuild and restart services
docker-compose down
docker-compose build --no-cache api admin worker
docker-compose up -d

# Check logs
docker-compose logs -f
```

## Certificate Renewal (Let's Encrypt)

Set up automatic renewal with crontab:

```bash
# Edit crontab
crontab -e

# Add renewal job (runs daily at 2 AM)
0 2 * * * certbot renew --quiet && \
  cp /etc/letsencrypt/live/eventscrape.overtheedgepaper.ca/fullchain.pem /path/to/EventScrape-1/ssl/ && \
  cp /etc/letsencrypt/live/eventscrape.overtheedgepaper.ca/privkey.pem /path/to/EventScrape-1/ssl/ && \
  docker-compose -f /path/to/EventScrape-1/docker-compose.yml restart nginx
```

## Security Considerations

1. **Firewall**: Only open ports 80 and 443 externally
2. **Database**: Keep PostgreSQL port 5432 internal (not exposed)
3. **API**: API port 3001 should only be accessible via nginx
4. **SSL**: Always use HTTPS in production
5. **Secrets**: Never commit `.env` file or SSL certificates to git

## Support

For issues or questions:
- Check GitHub Issues
- Review application logs: `docker-compose logs -f`
- Verify nginx configuration: `docker exec eventscrape-nginx nginx -t`
