import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, desc, and, asc, isNull, inArray, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { runs, sources, eventsRaw } from '../db/schema.js';
import { enqueueScrapeJob } from '../queue/queue.js';

const querySchema = z.object({
  sourceId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  page: z.coerce.number().int().positive().default(1),
});

export const runsRoutes: FastifyPluginAsync = async (fastify) => {
  // Get runs with optional source filtering
  fastify.get('/', async (request, reply) => {
    try {
      const query = querySchema.parse(request.query);
      
      const conditions = [isNull(runs.parentRunId)];
      if (query.sourceId) {
        conditions.push(eq(runs.sourceId, query.sourceId));
      }

      const whereClause = and(...conditions);
      const offset = (query.page - 1) * query.limit;

      const [{ count: totalRaw = 0 }] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(runs)
        .where(whereClause);

      const total = Number(totalRaw);

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
        .limit(query.limit)
        .offset(offset);

      const parentIds = runsWithSources.map(item => item.run.id);
      let childRuns: Array<{ run: typeof runs.$inferSelect; source: { id: string | null; name: string | null; moduleKey: string | null } }> = [];

      if (parentIds.length > 0) {
        childRuns = await db
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
          .where(inArray(runs.parentRunId, parentIds))
          .orderBy(asc(runs.startedAt));
      }

      const childrenByParent = new Map<string, typeof childRuns>();
      for (const child of childRuns) {
        const parentId = child.run.parentRunId;
        if (!parentId) continue;
        if (!childrenByParent.has(parentId)) {
          childrenByParent.set(parentId, []);
        }
        childrenByParent.get(parentId)!.push(child);
      }

      const runsWithChildren = runsWithSources.map(item => {
        const children = childrenByParent.get(item.run.id) ?? [];
        const summary = children.reduce(
          (acc, child) => {
            acc.total += 1;
            switch (child.run.status) {
              case 'success':
                acc.success += 1;
                break;
              case 'error':
              case 'partial':
                acc.failed += 1;
                break;
              case 'running':
                acc.running += 1;
                acc.pending += 1;
                break;
              case 'queued':
                acc.queued += 1;
                acc.pending += 1;
                break;
              default:
                break;
            }
            return acc;
          },
          { total: 0, success: 0, failed: 0, pending: 0, running: 0, queued: 0 }
        );

        return {
          ...item,
          children,
          summary,
        };
      });

      return {
        runs: runsWithChildren,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.limit)),
        },
      };
    } catch (error: any) {
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

    const events = await db
      .select({
        id: eventsRaw.id,
        title: eventsRaw.title,
        startDatetime: eventsRaw.startDatetime,
        endDatetime: eventsRaw.endDatetime,
        venueName: eventsRaw.venueName,
        venueAddress: eventsRaw.venueAddress,
        city: eventsRaw.city,
        region: eventsRaw.region,
        country: eventsRaw.country,
        url: eventsRaw.url,
        category: eventsRaw.category,
        organizer: eventsRaw.organizer,
        sourceEventId: eventsRaw.sourceEventId,
      })
      .from(eventsRaw)
      .where(eq(eventsRaw.runId, id))
      .orderBy(asc(eventsRaw.startDatetime));

    const childRuns = await db
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
      .where(eq(runs.parentRunId, id))
      .orderBy(asc(runs.startedAt));

    return { run: { ...result[0], events, children: childRuns } };
  });

  // Trigger a new scrape run for a source
  fastify.post('/scrape/:sourceKey', async (request, reply) => {
    const { sourceKey } = request.params as { sourceKey: string };
    const options = request.body as any;
    
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

      // Enqueue the job with BullMQ with pagination options
      const jobData: any = {
        sourceId: source.id,
        runId: newRun.id,
        moduleKey: source.moduleKey,
        sourceName: source.name,
      };

      // Add pagination options if provided
      if (options) {
        if (options.scrapeMode) {
          jobData.scrapeMode = options.scrapeMode;
        }
        if (options.paginationOptions) {
          jobData.paginationOptions = options.paginationOptions;
        }
      }

      const job = await enqueueScrapeJob(jobData);

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
    } catch (error: any) {
      fastify.log.error('Failed to queue scrape job:', error);
      
      // Try to clean up the run record if it was created
      try {
        await db.delete(runs).where(eq(runs.sourceId, source.id));
      } catch {}
      
      reply.status(500);
      return { error: 'Failed to queue scrape job' };
    }
  });

  // Test scrape - runs only the first event
  fastify.post('/test/:sourceKey', async (request, reply) => {
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

      // Enqueue the job with BullMQ - with test flag
      const job = await enqueueScrapeJob({
        sourceId: source.id,
        runId: newRun.id,
        moduleKey: source.moduleKey,
        sourceName: source.name,
        testMode: true, // Only scrape first event
      });

      fastify.log.info(`Test scrape job queued for source ${sourceKey} (run: ${newRun.id}, job: ${job.id})`);

      reply.status(202);
      return {
        message: 'Test scrape job queued',
        run: newRun,
        source: {
          id: source.id,
          name: source.name,
          moduleKey: source.moduleKey,
        },
        jobId: job.id,
      };
    } catch (error: any) {
      fastify.log.error('Failed to queue test scrape job:', error);
      
      // Try to clean up the run record if it was created
      try {
        await db.delete(runs).where(eq(runs.sourceId, source.id));
      } catch {}
      
      reply.status(500);
      return { error: 'Failed to queue test scrape job' };
    }
  });

  // Cancel a running scrape
  fastify.post('/:runId/cancel', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    
    if (!runId || typeof runId !== 'string') {
      reply.status(400);
      return { error: 'Invalid run ID' };
    }

    // Find the run
    const [run] = await db
      .select()
      .from(runs)
      .where(eq(runs.id, runId));

    if (!run) {
      reply.status(404);
      return { error: 'Run not found' };
    }

    if (run.status !== 'running' && run.status !== 'queued') {
      reply.status(400);
      return { error: `Cannot cancel run with status '${run.status}'. Only running or queued runs can be cancelled.` };
    }

    try {
      // Update run status to cancelled
      await db
        .update(runs)
        .set({ 
          status: 'error',
          finishedAt: new Date(),
          errorsJsonb: { error: 'Cancelled by user' }
        })
        .where(eq(runs.id, runId));

      // TODO: Cancel the actual job in BullMQ queue
      // This would require implementing job cancellation in the queue system
      
      fastify.log.info(`Run ${runId} cancelled by user`);

      reply.status(200);
      return { message: 'Run cancelled successfully' };
    } catch (error: any) {
      fastify.log.error('Failed to cancel run:', error);
      reply.status(500);
      return { error: 'Failed to cancel run' };
    }
  });
};
