#!/bin/bash

# Development script to run services locally (without Docker)
set -e

echo "🚀 Starting Event Scraper development environment..."

# Check if PostgreSQL is running locally
if ! command -v psql &> /dev/null; then
    echo "❌ PostgreSQL not found. Install with: brew install postgresql"
    exit 1
fi

# Check if Redis is running locally  
if ! command -v redis-cli &> /dev/null; then
    echo "❌ Redis not found. Install with: brew install redis"
    exit 1
fi

# Start PostgreSQL if not running
if ! pg_isready -q; then
    echo "Starting PostgreSQL..."
    brew services start postgresql
    sleep 2
fi

# Start Redis if not running
if ! redis-cli ping &> /dev/null; then
    echo "Starting Redis..."
    brew services start redis
    sleep 2
fi

# Create database if it doesn't exist
createdb eventscrape 2>/dev/null || echo "Database already exists"

# Set local environment variables
export DATABASE_URL="postgres://$(whoami)@localhost:5432/eventscrape"
export REDIS_URL="redis://localhost:6379"
export NODE_ENV="development"

echo "✅ Services started!"
echo "Database URL: $DATABASE_URL"
echo "Redis URL: $REDIS_URL"
echo ""
echo "Next steps:"
echo "1. pnpm install"
echo "2. pnpm db:migrate"  
echo "3. pnpm db:seed"
echo "4. pnpm dev"