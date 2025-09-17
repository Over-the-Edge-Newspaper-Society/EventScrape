import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import pino from 'pino';

// Route handlers
import { eventsRoutes } from './routes/events.js';
import { runsRoutes } from './routes/runs.js';
import { sourcesRoutes } from './routes/sources.js';
import { matchesRoutes } from './routes/matches.js';
import { exportsRoutes } from './routes/exports.js';
import { healthRoutes } from './routes/health.js';
import { queueRoutes } from './routes/queue.js';
import { logsRoutes } from './routes/logs.js';
import { uploadsRoutes } from './routes/uploads.js';
import { posterImportRoutes } from './routes/poster-import.js';
import { schedulesRoutes } from './routes/schedules.js';
import { initScheduleWorker, syncSchedulesFromDb } from './queue/scheduler.js';
import { runMigrations } from './db/migrate.js';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string(),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
});

const env = envSchema.parse(process.env);

const logger = pino({
  level: env.NODE_ENV === 'development' ? 'debug' : 'info',
  transport: env.NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss Z',
      ignore: 'pid,hostname',
    }
  } : undefined,
});

const fastify = Fastify({
  logger: env.NODE_ENV === 'development' ? {
    level: 'debug',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      }
    }
  } : true,
  disableRequestLogging: env.NODE_ENV === 'production',
});

// Register plugins
await fastify.register(helmet, {
  contentSecurityPolicy: env.NODE_ENV === 'development' ? false : undefined,
});

const allowedOrigins = env.NODE_ENV === 'development'
  ? null
  : (env.CORS_ALLOWED_ORIGINS?.split(',').map(origin => origin.trim()).filter(Boolean) ?? ['http://localhost:3000']);

if (env.NODE_ENV !== 'development') {
  fastify.log.info({ allowedOrigins }, 'Configured CORS allowed origins');
}

await fastify.register(cors, {
  origin: env.NODE_ENV === 'development'
    ? true
    : (origin, cb) => {
        if (!origin) {
          cb(null, true);
          return;
        }
        if (allowedOrigins?.includes(origin)) {
          cb(null, true);
          return;
        }
        cb(new Error(`Origin ${origin} not allowed`), false);
      },
  credentials: true,
});

await fastify.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
});

// Add global error handler
fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error(error);
  
  if (error.validation) {
    reply.status(400).send({
      error: 'Validation Error',
      message: error.message,
      details: error.validation,
    });
    return;
  }

  if (error.statusCode && error.statusCode < 500) {
    reply.status(error.statusCode).send({
      error: error.name,
      message: error.message,
    });
    return;
  }

  reply.status(500).send({
    error: 'Internal Server Error',
    message: env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
  });
});

// Add global not found handler
fastify.setNotFoundHandler((request, reply) => {
  reply.status(404).send({
    error: 'Not Found',
    message: `Route ${request.method} ${request.url} not found`,
  });
});

// Register routes
await fastify.register(healthRoutes);
await fastify.register(eventsRoutes, { prefix: '/api/events' });
await fastify.register(runsRoutes, { prefix: '/api/runs' });
await fastify.register(sourcesRoutes, { prefix: '/api/sources' });
await fastify.register(matchesRoutes, { prefix: '/api/matches' });
await fastify.register(exportsRoutes, { prefix: '/api/exports' });
await fastify.register(queueRoutes, { prefix: '/api/queue' });
await fastify.register(logsRoutes, { prefix: '/api/logs' });
await fastify.register(uploadsRoutes, { prefix: '/api/uploads' });
await fastify.register(posterImportRoutes, { prefix: '/api/poster-import' });
await fastify.register(schedulesRoutes, { prefix: '/api/schedules' });

// Initialize schedule worker and sync schedules
await runMigrations();
initScheduleWorker();
await syncSchedulesFromDb();

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: env.PORT, host: '0.0.0.0' });
    fastify.log.info(`🚀 API server started on http://localhost:${env.PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Handle graceful shutdown
const gracefulShutdown = async (signal: string) => {
  fastify.log.info(`Received ${signal}, shutting down gracefully...`);
  await fastify.close();
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

start();
