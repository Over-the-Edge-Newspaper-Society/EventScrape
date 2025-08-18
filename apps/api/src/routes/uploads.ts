import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import { runs, sources } from '../db/schema.js';
import { enqueueScrapeJob } from '../queue/queue.js';
import { eq } from 'drizzle-orm';
import multipart from '@fastify/multipart';

const uploadSchema = z.object({
  sourceId: z.string().uuid(),
  testMode: z.boolean().optional(),
});

export const uploadsRoutes: FastifyPluginAsync = async (fastify) => {
  // Register multipart support if not already registered
  if (!fastify.hasContentTypeParser('multipart/form-data')) {
    await fastify.register(multipart, {
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max file size
      },
    });
  }

  // Upload CSV/JSON/Excel file for a source
  fastify.post('/', async (request, reply) => {
    try {
      // Parse multipart form data
      const data = await request.file();
      
      if (!data) {
        reply.status(400);
        return { error: 'No file uploaded' };
      }

      // Get form fields
      const fields: any = {};
      const parts = request.parts();
      
      for await (const part of parts) {
        if (part.type === 'field') {
          fields[part.fieldname] = part.value;
        } else if (part.type === 'file') {
          // Process the file
          const buffer = await part.toBuffer();
          const content = buffer.toString('utf-8');
          const filename = part.filename;
          
          // Determine file format
          let format: 'csv' | 'json' | 'xlsx';
          if (filename.endsWith('.csv')) {
            format = 'csv';
          } else if (filename.endsWith('.json')) {
            format = 'json';
          } else if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
            format = 'xlsx';
          } else {
            reply.status(400);
            return { error: 'Unsupported file format. Please upload CSV, JSON, or Excel file.' };
          }

          // Validate request data
          const validatedData = uploadSchema.parse({
            sourceId: fields.sourceId,
            testMode: fields.testMode === 'true',
          });

          // Get source information
          const [source] = await db
            .select()
            .from(sources)
            .where(eq(sources.id, validatedData.sourceId))
            .limit(1);

          if (!source) {
            reply.status(404);
            return { error: 'Source not found' };
          }

          // Create a new run
          const runId = uuidv4();
          await db.insert(runs).values({
            id: runId,
            sourceId: validatedData.sourceId,
            status: 'queued',
            startedAt: new Date(),
            eventsFound: 0,
            pagesCrawled: 0,
          });

          // Enqueue job with uploaded file data
          const job = await enqueueScrapeJob({
            sourceId: validatedData.sourceId,
            runId,
            moduleKey: source.moduleKey,
            sourceName: source.name,
            testMode: validatedData.testMode,
            uploadedFile: {
              path: '', // Not used for in-memory processing
              format,
              content,
            },
          } as any); // Type assertion to handle extended schema

          return {
            success: true,
            runId,
            jobId: job.id,
            message: `File uploaded successfully. Processing ${format.toUpperCase()} file for ${source.name}`,
          };
        }
      }

      reply.status(400);
      return { error: 'Invalid request format' };
      
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        reply.status(400);
        return { error: 'Validation error', details: error.errors };
      }
      
      console.error('Upload error:', error);
      reply.status(500);
      return { error: 'Failed to process upload' };
    }
  });

  // Get upload configuration for a source
  fastify.get('/config/:sourceId', async (request, reply) => {
    try {
      const { sourceId } = request.params as { sourceId: string };
      
      // Get source information
      const [source] = await db
        .select()
        .from(sources)
        .where(eq(sources.id, sourceId))
        .limit(1);

      if (!source) {
        reply.status(404);
        return { error: 'Source not found' };
      }

      // TODO: Get upload config from module
      // For now, return config for UNBC Timberwolves
      if (source.moduleKey === 'unbctimberwolves_com') {
        return {
          supportedFormats: ['csv'],
          instructions: `To download events manually:
1. Go to https://unbctimberwolves.com/calendar
2. Click the "Sync/Download" button (calendar icon)
3. Select "Excel" as the export format
4. Click "Download Now"
5. Upload the downloaded CSV file here`,
          downloadUrl: 'https://unbctimberwolves.com/calendar',
        };
      }

      reply.status(404);
      return { error: 'Upload not supported for this source' };
      
    } catch (error: any) {
      console.error('Config error:', error);
      reply.status(500);
      return { error: 'Failed to get upload configuration' };
    }
  });
};