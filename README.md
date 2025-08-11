# Event Scraper Review System

A modular event scraping and review system with duplicate detection, built with TypeScript, PostgreSQL, and Docker.

## 🚀 Quick Start

### Option 1: Docker (Recommended)
```bash
# Development with hot reload
docker-compose -f docker-compose.dev.yml up

# Production
docker-compose up -d
```

### Option 2: Local Development
```bash
# Start database services
pnpm docker:up

# Install dependencies and start
pnpm install
pnpm dev
```

**Access:**
- Admin Dashboard: http://localhost:3000
- API: http://localhost:3001
- Database: localhost:5432 (user: `eventscrape`, password: `eventscrape_dev`)

## 📋 Table of Contents

- [Architecture](#architecture)
- [Features](#features)
- [Docker Setup](#docker-setup)
- [Local Development](#local-development)
- [API Documentation](#api-documentation)
- [Database](#database)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

## 🏗️ Architecture

### Components
- **API Server** (`apps/api`): Fastify-based REST API
- **Admin UI** (`apps/admin`): React + Vite dashboard
- **Worker** (`worker`): Background job processor with Playwright
- **Database**: PostgreSQL with automatic migrations
- **Cache/Queue**: Redis for job queues and caching

### Tech Stack
- **Backend**: TypeScript, Fastify, Drizzle ORM
- **Frontend**: React, TypeScript, TailwindCSS, Radix UI
- **Database**: PostgreSQL 15
- **Queue**: BullMQ + Redis
- **Scraping**: Playwright
- **Deployment**: Docker + Docker Compose

## ✨ Features

### Core Functionality
- 🔍 **Multi-source event scraping** with configurable modules
- 🔄 **Duplicate detection** using fuzzy matching algorithms
- 📊 **Manual review interface** for potential matches
- 📤 **Multiple export formats** (CSV, JSON, ICS, WordPress)
- 🚦 **Rate limiting** and respectful scraping
- 📈 **Real-time monitoring** and health checks

### Data Pipeline
1. **Scrape** events from configured sources
2. **Store** raw events with metadata
3. **Detect** potential duplicates using ML algorithms
4. **Review** matches through admin interface
5. **Export** canonical events to various formats

## 🐳 Docker Setup

### Development Environment
```bash
# Start with hot reload (recommended for development)
docker-compose -f docker-compose.dev.yml up

# Features:
# - Volume mounts for live code reloading
# - Automatic dependency installation
# - Database migrations and seeding
```

### Production Environment
```bash
# Build and start production containers
docker-compose build
docker-compose up -d

# Features:
# - Optimized builds
# - Health checks and restart policies
# - Persistent volumes
```

### Available Commands
```bash
# Development
pnpm docker:dev          # Start dev environment
pnpm docker:dev:build    # Rebuild and start dev

# Production  
pnpm docker:prod         # Start production
pnpm docker:prod:build   # Build and start production

# Management
pnpm docker:logs         # View logs
pnpm docker:stop         # Stop services
pnpm docker:clean        # Remove everything including volumes
```

### Service Configuration

| Service | Port | Description |
|---------|------|-------------|
| **admin** | 3000 | React admin dashboard |
| **api** | 3001 | REST API server |
| **postgres** | 5432 | PostgreSQL database |
| **redis** | 6379 | Redis cache/queue |
| **worker** | - | Background job processor |

## 💻 Local Development

### Prerequisites
- Node.js 18+
- pnpm 8+
- Docker & Docker Compose
- PostgreSQL 15+ (if not using Docker)
- Redis 7+ (if not using Docker)

### Setup
```bash
# Clone repository
git clone <repository-url>
cd EventScrape

# Install dependencies
pnpm install

# Copy environment files
cp .env.example .env

# Start database services
pnpm docker:up

# Run migrations and seed data
pnpm db:migrate
pnpm db:seed

# Start development servers
pnpm dev
```

### Development Scripts
```bash
# Development
pnpm dev              # Start all services
pnpm dev:seed         # Start with fresh database seed

# Building
pnpm build            # Build all packages
pnpm typecheck        # Type checking
pnpm lint             # Linting

# Database
pnpm db:migrate       # Run migrations
pnpm db:seed          # Seed database
pnpm db:studio        # Open Drizzle Studio

# Testing
pnpm test             # Run tests
```

## 🔌 API Documentation

### Base URL
- Development: `http://localhost:3001/api`
- Production: Configure `VITE_API_URL`

### Key Endpoints

#### Sources
```bash
GET    /api/sources           # List event sources
POST   /api/sources           # Create new source
PUT    /api/sources/:id       # Update source
DELETE /api/sources/:id       # Delete source
```

#### Scraping
```bash
GET    /api/runs              # List scrape runs
POST   /api/runs/scrape/:key  # Start scrape job
GET    /api/runs/:id          # Get run details
```

#### Events
```bash
GET    /api/events/raw        # List raw scraped events
GET    /api/events/canonical  # List canonical events
POST   /api/events/merge      # Merge duplicate events
```

#### Matching
```bash
GET    /api/matches           # List potential matches
POST   /api/matches/:id/confirm # Confirm match
POST   /api/matches/:id/reject  # Reject match
```

#### Export
```bash
POST   /api/exports           # Create export job
GET    /api/exports           # List export history
GET    /api/exports/:id       # Download export file
```

### Response Format
```json
{
  "data": { ... },
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": "100",
    "totalPages": 5,
    "hasNext": true,
    "hasPrev": false
  }
}
```

## 🗄️ Database

### Schema Overview
- **sources**: Event source configurations
- **runs**: Scraping job execution records  
- **events_raw**: Original scraped event data
- **events_canonical**: Deduplicated canonical events
- **matches**: Potential duplicate pairs for review
- **exports**: Export job history

### Migrations
```bash
# Run migrations
pnpm db:migrate

# Create new migration
cd apps/api
pnpm drizzle-kit generate:pg
```

### Seeding
```bash
# Seed with sample data
pnpm db:seed

# Includes:
# - Sample event sources
# - Test scraping modules
# - Demo events (optional)
```

## ⚙️ Configuration

### Environment Variables

#### Database
```bash
DATABASE_URL=postgres://eventscrape:password@localhost:5432/eventscrape
```

#### Redis
```bash  
REDIS_URL=redis://localhost:6379
```

#### API Configuration
```bash
NODE_ENV=development
PORT=3001
```

#### Worker Settings
```bash
PLAYWRIGHT_HEADLESS=true
EXPORT_DIR=./exports
RATE_LIMIT_PER_MIN=60
```

#### Admin UI
```bash
VITE_API_URL=http://localhost:3001/api
```

#### Optional: WordPress Integration
```bash
WORDPRESS_BASE_URL=https://your-site.com
WORDPRESS_USERNAME=admin
WORDPRESS_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
```

### Docker Environment Files
- `.env.docker` - Template for Docker deployments
- `.env.example` - Template for local development
- Copy and customize as needed

## 🚀 Deployment

### Docker Production
```bash
# Using production compose file
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d

# With custom environment
cp .env.docker .env
# Edit .env with production values
docker-compose -f docker-compose.prod.yml up -d
```

### Environment Setup
1. Set strong database passwords
2. Configure proper CORS origins
3. Set up SSL certificates (if using nginx profile)
4. Configure backup strategies
5. Set up monitoring and logging

### Health Checks
- API: `GET /health`
- Database connectivity
- Redis connectivity
- Worker status monitoring

## 🔧 Troubleshooting

### Common Issues

#### Database Connection Errors
```bash
# Check if database is running
docker ps | grep postgres

# Reset database
docker-compose down -v
docker-compose up -d postgres
pnpm db:migrate
```

#### Permission Errors
```bash
# Grant database permissions
psql -d eventscrape -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO eventscrape;"
```

#### API Not Connecting
```bash
# Check API logs
docker logs eventscrape-api

# Verify environment variables
docker exec eventscrape-api env | grep DATABASE_URL
```

#### Worker Issues
```bash
# Check worker logs
docker logs eventscrape-worker

# Restart worker
docker restart eventscrape-worker
```

#### Build Failures
```bash
# Clean rebuild
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Debug Commands
```bash
# Container status
docker-compose ps

# View logs
docker-compose logs -f [service]

# Execute commands in container
docker exec -it eventscrape-api sh

# Database access
docker exec -it eventscrape-postgres psql -U eventscrape

# Reset everything
docker-compose down -v && docker-compose up -d
```

### Performance Tuning
- Adjust `RATE_LIMIT_PER_MIN` for scraping speed
- Configure PostgreSQL connection pooling
- Optimize Redis memory usage
- Scale worker processes as needed

## 📚 Additional Resources

### Documentation
- [Docker Setup Guide](./DOCKER.md) - Detailed Docker instructions
- [API Reference](./apps/api/README.md) - Complete API documentation  
- [Admin UI Guide](./apps/admin/README.md) - Dashboard user guide
- [Worker Documentation](./worker/README.md) - Scraping configuration

### Development
- [Contributing Guidelines](./CONTRIBUTING.md)
- [Code Style Guide](./STYLE.md)
- [Testing Guide](./TESTING.md)

## 📄 License

[Your License Here]

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

For major changes, please open an issue first to discuss proposed changes.

---

**Need Help?** Check the [troubleshooting section](#troubleshooting) or open an issue on GitHub.