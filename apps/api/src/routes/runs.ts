import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, desc, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { runs, sources } from '../db/schema.js';
import { enqueueScrapeJob } from '../queue/queue.js';

const querySchema = z.object({
  sourceId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const runsRoutes: FastifyPluginAsync = async (fastify) => {
  // Get runs with optional source filtering
  fastify.get('/', async (request, reply) => {
    try {
      const query = querySchema.parse(request.query);
      
      const conditions = [];
      if (query.sourceId) {
        conditions.push(eq(runs.sourceId, query.sourceId));
      }
      
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const runsWithSources = await db
        .select({
          run: runs,
          source: {
            id: sources.id,
            name: sources.name,
            moduleKey: sources.moduleKey,
          },
        })
        .from(runs)
        .leftJoin(sources, eq(runs.sourceId, sources.id))
        .where(whereClause)
        .orderBy(desc(runs.startedAt))
        .limit(query.limit);

      return { runs: runsWithSources };
    } catch (error) {
      if (error instanceof z.ZodError) {
        reply.status(400);
        return { error: 'Validation error', details: error.errors };
      }
      throw error;
    }
  });

  // Get single run by ID
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    if (!id || typeof id !== 'string') {
      reply.status(400);
      return { error: 'Invalid run ID' };
    }

    const result = await db
      .select({
        run: runs,
        source: {
          id: sources.id,
          name: sources.name,
          moduleKey: sources.moduleKey,
          baseUrl: sources.baseUrl,
        },
      })
      .from(runs)
      .leftJoin(sources, eq(runs.sourceId, sources.id))
      .where(eq(runs.id, id));
    
    if (result.length === 0) {
      reply.status(404);
      return { error: 'Run not found' };
    }

    return { run: result[0] };
  });

  // Trigger a new scrape run for a source
  fastify.post('/scrape/:sourceKey', async (request, reply) => {
    const { sourceKey } = request.params as { sourceKey: string };
    
    if (!sourceKey || typeof sourceKey !== 'string') {
      reply.status(400);
      return { error: 'Invalid source key' };
    }

    // Find the source
    const [source] = await db
      .select()
      .from(sources)
      .where(eq(sources.moduleKey, sourceKey));

    if (!source) {
      reply.status(404);
      return { error: 'Source not found' };
    }

    if (!source.active) {
      reply.status(400);
      return { error: 'Source is not active' };
    }

    try {
      // Create a new run record
      const runId = uuidv4();
      const [newRun] = await db
        .insert(runs)
        .values({
          id: runId,
          sourceId: source.id,
          status: 'queued',
        })
        .returning();

      // Enqueue the job with BullMQ
      const job = await enqueueScrapeJob({
        sourceId: source.id,
        runId: newRun.id,
        moduleKey: source.moduleKey,
        sourceName: source.name,
      });

      fastify.log.info(`Scrape job queued for source ${sourceKey} (run: ${newRun.id}, job: ${job.id})`);

      reply.status(202);
      return {
        message: 'Scrape job queued',
        run: newRun,
        source: {
          id: source.id,
          name: source.name,
          moduleKey: source.moduleKey,
        },
        jobId: job.id,
      };
    } catch (error) {
      fastify.log.error('Failed to queue scrape job:', error);
      
      // Try to clean up the run record if it was created
      try {
        await db.delete(runs).where(eq(runs.sourceId, source.id));
      } catch {}
      
      reply.status(500);
      return { error: 'Failed to queue scrape job' };
    }
  });
};