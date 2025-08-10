import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { exports as exportsTable } from '../db/schema.js';

const exportSchema = z.object({
  format: z.enum(['csv', 'json', 'ics', 'wp-rest']),
  filters: z.object({
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    city: z.string().optional(),
    category: z.string().optional(),
    status: z.enum(['new', 'ready', 'exported', 'ignored']).optional(),
  }).default({}),
  fieldMap: z.record(z.string()).optional(),
});

export const exportsRoutes: FastifyPluginAsync = async (fastify) => {
  // Get export history
  fastify.get('/', async (request, reply) => {
    const exportHistory = await db
      .select()
      .from(exportsTable)
      .orderBy(desc(exportsTable.createdAt))
      .limit(50);

    return { exports: exportHistory };
  });

  // Get single export by ID
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    if (!id || typeof id !== 'string') {
      reply.status(400);
      return { error: 'Invalid export ID' };
    }

    const [exportRecord] = await db
      .select()
      .from(exportsTable)
      .where(eq(exportsTable.id, id));
    
    if (!exportRecord) {
      reply.status(404);
      return { error: 'Export not found' };
    }

    return { export: exportRecord };
  });

  // Create new export
  fastify.post('/', async (request, reply) => {
    try {
      const data = exportSchema.parse(request.body);

      // TODO: Implement actual export logic when export system is ready
      // For now, just create a placeholder export record
      
      const [newExport] = await db
        .insert(exportsTable)
        .values({
          format: data.format,
          itemCount: 0, // Will be updated when actual export runs
          params: {
            filters: data.filters,
            fieldMap: data.fieldMap,
          },
          status: 'success', // Placeholder
        })
        .returning();

      fastify.log.info(`Export job created: ${newExport.id} (${data.format})`);

      reply.status(202);
      return {
        message: 'Export job queued',
        export: newExport,
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        reply.status(400);
        return { error: 'Validation error', details: error.errors };
      }
      throw error;
    }
  });

  // Download export file
  fastify.get('/:id/download', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    if (!id || typeof id !== 'string') {
      reply.status(400);
      return { error: 'Invalid export ID' };
    }

    const [exportRecord] = await db
      .select()
      .from(exportsTable)
      .where(eq(exportsTable.id, id));
    
    if (!exportRecord) {
      reply.status(404);
      return { error: 'Export not found' };
    }

    if (exportRecord.status === 'error') {
      reply.status(400);
      return { error: 'Export failed', message: exportRecord.errorMessage };
    }

    if (!exportRecord.filePath) {
      reply.status(404);
      return { error: 'Export file not available' };
    }

    // TODO: Implement file serving when export files exist
    reply.status(501);
    return { error: 'File download not yet implemented' };
  });
};