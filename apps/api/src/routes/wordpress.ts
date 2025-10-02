import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { wordpressSettings, eventsRaw, sources } from '../db/schema.js';
import { WordPressClient } from '../services/wordpress-client.js';

const wpSettingsSchema = z.object({
  name: z.string().min(1),
  siteUrl: z.string().url(),
  username: z.string().min(1),
  applicationPassword: z.string().min(1),
  active: z.boolean().default(true),
  sourceCategoryMappings: z.record(z.string(), z.number()).optional(),
  includeMedia: z.boolean().default(true),
});

const wpUploadSchema = z.object({
  settingsId: z.string().uuid(),
  eventIds: z.array(z.string().uuid()),
  status: z.enum(['publish', 'draft', 'pending']).default('draft'),
});

export const wordpressRoutes: FastifyPluginAsync = async (fastify) => {
  // Get all sources (for source-category mapping)
  fastify.get('/sources', async () => {
    const allSources = await db
      .select({
        id: sources.id,
        name: sources.name,
        moduleKey: sources.moduleKey,
        active: sources.active,
      })
      .from(sources)
      .orderBy(sources.name);

    return { sources: allSources };
  });

  // Get all WordPress settings
  fastify.get('/settings', async () => {
    const settings = await db
      .select({
        id: wordpressSettings.id,
        name: wordpressSettings.name,
        siteUrl: wordpressSettings.siteUrl,
        username: wordpressSettings.username,
        // Don't return the application password for security
        active: wordpressSettings.active,
        sourceCategoryMappings: wordpressSettings.sourceCategoryMappings,
        includeMedia: wordpressSettings.includeMedia,
        createdAt: wordpressSettings.createdAt,
        updatedAt: wordpressSettings.updatedAt,
      })
      .from(wordpressSettings)
      .orderBy(desc(wordpressSettings.createdAt));

    return { settings };
  });

  // Get single WordPress setting
  fastify.get('/settings/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const [setting] = await db
      .select({
        id: wordpressSettings.id,
        name: wordpressSettings.name,
        siteUrl: wordpressSettings.siteUrl,
        username: wordpressSettings.username,
        active: wordpressSettings.active,
        sourceCategoryMappings: wordpressSettings.sourceCategoryMappings,
        includeMedia: wordpressSettings.includeMedia,
        createdAt: wordpressSettings.createdAt,
        updatedAt: wordpressSettings.updatedAt,
      })
      .from(wordpressSettings)
      .where(eq(wordpressSettings.id, id));

    if (!setting) {
      reply.status(404);
      return { error: 'WordPress setting not found' };
    }

    return { setting };
  });

  // Create new WordPress setting
  fastify.post('/settings', async (request, reply) => {
    try {
      const data = wpSettingsSchema.parse(request.body);

      // Test connection before saving
      const testClient = new WordPressClient({
        id: '',
        siteUrl: data.siteUrl,
        username: data.username,
        applicationPassword: data.applicationPassword,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        name: data.name,
        sourceCategoryMappings: data.sourceCategoryMappings || {},
        includeMedia: data.includeMedia,
      });

      const testResult = await testClient.testConnection();
      if (!testResult.success) {
        reply.status(400);
        return { error: testResult.error };
      }

      const [newSetting] = await db
        .insert(wordpressSettings)
        .values({
          name: data.name,
          siteUrl: data.siteUrl,
          username: data.username,
          applicationPassword: data.applicationPassword,
          active: data.active,
          sourceCategoryMappings: data.sourceCategoryMappings || {},
          includeMedia: data.includeMedia,
        })
        .returning({
          id: wordpressSettings.id,
          name: wordpressSettings.name,
          siteUrl: wordpressSettings.siteUrl,
          username: wordpressSettings.username,
          active: wordpressSettings.active,
          sourceCategoryMappings: wordpressSettings.sourceCategoryMappings,
          includeMedia: wordpressSettings.includeMedia,
          createdAt: wordpressSettings.createdAt,
          updatedAt: wordpressSettings.updatedAt,
        });

      reply.status(201);
      return {
        message: 'WordPress setting created successfully',
        setting: newSetting,
      };
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        reply.status(400);
        return { error: 'Validation error', details: error.errors };
      }
      throw error;
    }
  });

  // Update WordPress setting
  fastify.put('/settings/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const data = wpSettingsSchema.partial().parse(request.body);

      // If credentials are being updated, test connection
      if (data.siteUrl || data.username || data.applicationPassword) {
        const [existing] = await db
          .select()
          .from(wordpressSettings)
          .where(eq(wordpressSettings.id, id));

        if (!existing) {
          reply.status(404);
          return { error: 'WordPress setting not found' };
        }

        const testClient = new WordPressClient({
          ...existing,
          siteUrl: data.siteUrl || existing.siteUrl,
          username: data.username || existing.username,
          applicationPassword:
            data.applicationPassword || existing.applicationPassword,
        });

        const testResult = await testClient.testConnection();
        if (!testResult.success) {
          reply.status(400);
          return { error: testResult.error };
        }
      }

      const [updated] = await db
        .update(wordpressSettings)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(eq(wordpressSettings.id, id))
        .returning({
          id: wordpressSettings.id,
          name: wordpressSettings.name,
          siteUrl: wordpressSettings.siteUrl,
          username: wordpressSettings.username,
          active: wordpressSettings.active,
          sourceCategoryMappings: wordpressSettings.sourceCategoryMappings,
          includeMedia: wordpressSettings.includeMedia,
          createdAt: wordpressSettings.createdAt,
          updatedAt: wordpressSettings.updatedAt,
        });

      if (!updated) {
        reply.status(404);
        return { error: 'WordPress setting not found' };
      }

      return {
        message: 'WordPress setting updated successfully',
        setting: updated,
      };
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        reply.status(400);
        return { error: 'Validation error', details: error.errors };
      }
      throw error;
    }
  });

  // Delete WordPress setting
  fastify.delete('/settings/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const [deleted] = await db
      .delete(wordpressSettings)
      .where(eq(wordpressSettings.id, id))
      .returning();

    if (!deleted) {
      reply.status(404);
      return { error: 'WordPress setting not found' };
    }

    return { message: 'WordPress setting deleted successfully' };
  });

  // Test connection
  fastify.post('/settings/:id/test', async (request, reply) => {
    const { id } = request.params as { id: string };

    const [setting] = await db
      .select()
      .from(wordpressSettings)
      .where(eq(wordpressSettings.id, id));

    if (!setting) {
      reply.status(404);
      return { error: 'WordPress setting not found' };
    }

    const client = new WordPressClient(setting);
    const result = await client.testConnection();

    if (!result.success) {
      reply.status(400);
    }

    return result;
  });

  // Get event categories from WordPress
  fastify.get('/settings/:id/categories', async (request, reply) => {
    const { id } = request.params as { id: string };

    const [setting] = await db
      .select()
      .from(wordpressSettings)
      .where(eq(wordpressSettings.id, id));

    if (!setting) {
      reply.status(404);
      return { error: 'WordPress setting not found' };
    }

    const client = new WordPressClient(setting);
    const categories = await client.getCategories();

    return { categories };
  });

  // Upload events to WordPress
  fastify.post('/upload', async (request, reply) => {
    try {
      const data = wpUploadSchema.parse(request.body);

      // Get WordPress settings
      const [setting] = await db
        .select()
        .from(wordpressSettings)
        .where(eq(wordpressSettings.id, data.settingsId));

      if (!setting) {
        reply.status(404);
        return { error: 'WordPress setting not found' };
      }

      if (!setting.active) {
        reply.status(400);
        return { error: 'WordPress setting is not active' };
      }

      // Get events
      const events = await db
        .select()
        .from(eventsRaw)
        .where(
          eq(eventsRaw.id, data.eventIds[0])
          // Note: Using eq for first item, would need inArray for multiple
        );

      if (data.eventIds.length > 1) {
        // Fetch all events
        const allEvents = await db.select().from(eventsRaw);
        const filteredEvents = allEvents.filter((e) =>
          data.eventIds.includes(e.id)
        );
        events.length = 0;
        events.push(...filteredEvents);
      }

      if (events.length === 0) {
        reply.status(404);
        return { error: 'No events found' };
      }

      // Upload to WordPress
      const client = new WordPressClient(setting);
      const results = await client.uploadEvents(
        events.map((e) => ({
          id: e.id,
          title: e.title,
          descriptionHtml: e.descriptionHtml || undefined,
          startDatetime: e.startDatetime,
          endDatetime: e.endDatetime || undefined,
          timezone: e.timezone || undefined,
          venueName: e.venueName || undefined,
          venueAddress: e.venueAddress || undefined,
          city: e.city || undefined,
          organizer: e.organizer || undefined,
          category: e.category || undefined,
          url: e.url,
          imageUrl: e.imageUrl || undefined,
          raw: e.raw,
          sourceId: e.sourceId,
        })),
        {
          status: data.status || 'draft',
          updateIfExists: false,
          sourceCategoryMappings: setting.sourceCategoryMappings as Record<string, number> || {},
          includeMedia: setting.includeMedia,
        }
      );

      const successCount = results.filter((r) => r.result.success).length;
      const failureCount = results.length - successCount;

      reply.status(200);
      return {
        message: `Uploaded ${successCount} events, ${failureCount} failed`,
        results,
      };
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        reply.status(400);
        return { error: 'Validation error', details: error.errors };
      }
      throw error;
    }
  });
};
