import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { sources, NewSource } from '../db/schema.js';
import { readdir, stat } from 'fs/promises';
import { join, resolve } from 'path';

const createSourceSchema = z.object({
  name: z.string().min(1),
  baseUrl: z.string().url(),
  moduleKey: z.string().min(1),
  active: z.boolean().default(true),
  defaultTimezone: z.string().default('UTC'),
  notes: z.string().optional(),
  rateLimitPerMin: z.number().int().positive().default(60),
  scrapingEngine: z.enum(['playwright', 'firecrawl']).default('playwright'),
});

const updateSourceSchema = createSourceSchema.partial();

// Helper function to load available modules from worker
async function loadAvailableModules(): Promise<Array<{key: string, label: string, baseUrl: string}>> {
  const modules: Array<{key: string, label: string, baseUrl: string}> = [];

  // Path to worker modules directory - handle both dev and production paths
  const isProduction = process.env.NODE_ENV === 'production';
  const modulesPath = isProduction
    ? resolve(process.cwd(), 'apps/api/dist/worker/src/modules')
    : resolve(process.cwd(), '../../worker/src/modules');

  console.log(`[loadAvailableModules] NODE_ENV=${process.env.NODE_ENV}, isProduction=${isProduction}, modulesPath=${modulesPath}, cwd=${process.cwd()}`);

  try {
    const entries = await readdir(modulesPath, { withFileTypes: true });
    const moduleDirs = entries.filter(entry => entry.isDirectory());
    console.log(`[loadAvailableModules] Found ${moduleDirs.length} module directories:`, moduleDirs.map(d => d.name));

    for (const dir of moduleDirs) {
      try {
        // Try to import the module to get its metadata
        const modulePath = join(modulesPath, dir.name, 'index.ts');
        const modulePathJs = join(modulesPath, dir.name, 'index.js');
        
        // Check if index.ts or index.js exists
        let moduleExists = false;
        try {
          await stat(modulePath);
          moduleExists = true;
        } catch {
          try {
            await stat(modulePathJs);
            moduleExists = true;
          } catch {
            // Module file doesn't exist, skip
          }
        }
        
        if (moduleExists) {
          // For now, infer basic info from directory name
          // In a full implementation, you'd want to actually import the module
          const key = dir.name;
          const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          const baseUrl = `https://${key.replace(/_/g, '.')}/`;
          
          modules.push({ key, label, baseUrl });
        }
      } catch (error: any) {
        console.error(`Failed to load module info for ${dir.name}:`, error);
      }
    }
  } catch (error: any) {
    console.error('[loadAvailableModules] Failed to read modules directory:', error);
    console.error('[loadAvailableModules] Error details:', {
      message: error.message,
      code: error.code,
      path: modulesPath
    });
    // Don't throw - return empty array and let sync endpoint handle it
  }

  console.log(`[loadAvailableModules] Returning ${modules.length} modules`);
  return modules;
}

export const sourcesRoutes: FastifyPluginAsync = async (fastify) => {
  // Get all sources (excluding Instagram sources - those are in separate table)
  fastify.get('/', async () => {
    const allSources = await db.select().from(sources).where(eq(sources.sourceType, 'website'));
    return { sources: allSources };
  });

  // Sync available modules with database
  fastify.post('/sync', async (_, reply) => {
    try {
      fastify.log.info('[/sync] Starting sync process...');
      const availableModules = await loadAvailableModules();
      fastify.log.info(`[/sync] Loaded ${availableModules.length} available modules`);
      const existingSources = await db.select().from(sources);
      fastify.log.info(`[/sync] Found ${existingSources.length} existing sources`);
      
      let created = 0;
      let updated = 0;
      
      for (const module of availableModules) {
        const existingSource = existingSources.find(s => s.moduleKey === module.key);
        
        if (!existingSource) {
          // Create new source
          const newSource: NewSource = {
            name: module.label,
            baseUrl: module.baseUrl,
            moduleKey: module.key,
            active: true,
            defaultTimezone: 'America/Vancouver', // Default for BC
            notes: 'Auto-created from available module',
            rateLimitPerMin: 30,
            updatedAt: new Date(),
          };
          
          await db.insert(sources).values(newSource);
          created++;
        } else if (!existingSource.active) {
          // Reactivate inactive source if module is available
          // Remove old status messages before adding new one
          let cleanedNotes = existingSource.notes || '';
          cleanedNotes = cleanedNotes
            .replace(/\s*\(Deactivated - module not found\)\s*/g, '')
            .replace(/\s*\(Reactivated from available module\)\s*/g, '')
            .trim();

          const newNotes = cleanedNotes
            ? `${cleanedNotes} (Reactivated from available module)`
            : 'Reactivated from available module';

          await db
            .update(sources)
            .set({
              active: true,
              updatedAt: new Date(),
              notes: newNotes
            })
            .where(eq(sources.id, existingSource.id));
          updated++;
        }
      }
      
      // Optionally deactivate sources that don't have corresponding modules
      const moduleKeys = availableModules.map(m => m.key);
      const orphanedSources = existingSources.filter(s => s.active && !moduleKeys.includes(s.moduleKey));
      
      let deactivated = 0;
      for (const orphan of orphanedSources) {
        // Remove old status messages before adding new one
        let cleanedNotes = orphan.notes || '';
        cleanedNotes = cleanedNotes
          .replace(/\s*\(Deactivated - module not found\)\s*/g, '')
          .replace(/\s*\(Reactivated from available module\)\s*/g, '')
          .trim();

        const newNotes = cleanedNotes
          ? `${cleanedNotes} (Deactivated - module not found)`
          : 'Deactivated - module not found';

        await db
          .update(sources)
          .set({
            active: false,
            updatedAt: new Date(),
            notes: newNotes
          })
          .where(eq(sources.id, orphan.id));
        deactivated++;
      }
      
      return {
        message: 'Sources synced successfully',
        stats: {
          availableModules: availableModules.length,
          created,
          updated,
          deactivated
        },
        availableModules
      };
    } catch (error: any) {
      fastify.log.error('Failed to sync sources:', error);
      reply.status(500);
      return { error: 'Failed to sync sources', details: error instanceof Error ? error.message : String(error) };
    }
  });

  // Get source by ID
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    if (!id || typeof id !== 'string') {
      reply.status(400);
      return { error: 'Invalid source ID' };
    }

    const source = await db.select().from(sources).where(eq(sources.id, id));
    
    if (source.length === 0) {
      reply.status(404);
      return { error: 'Source not found' };
    }

    return { source: source[0] };
  });

  // Create new source
  fastify.post('/', async (request, reply) => {
    try {
      const data = createSourceSchema.parse(request.body);
      
      const newSource: NewSource = {
        ...data,
        updatedAt: new Date(),
      };

      const [created] = await db.insert(sources).values(newSource).returning();
      
      reply.status(201);
      return { source: created };
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        reply.status(400);
        return { error: 'Validation error', details: error.errors };
      }
      throw error;
    }
  });

  // Update source
  fastify.put('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    if (!id || typeof id !== 'string') {
      reply.status(400);
      return { error: 'Invalid source ID' };
    }

    try {
      const data = updateSourceSchema.parse(request.body);
      
      const [updated] = await db
        .update(sources)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(sources.id, id))
        .returning();

      if (!updated) {
        reply.status(404);
        return { error: 'Source not found' };
      }

      return { source: updated };
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        reply.status(400);
        return { error: 'Validation error', details: error.errors };
      }
      throw error;
    }
  });

  // Delete source
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    if (!id || typeof id !== 'string') {
      reply.status(400);
      return { error: 'Invalid source ID' };
    }

    const [deleted] = await db
      .delete(sources)
      .where(eq(sources.id, id))
      .returning();

    if (!deleted) {
      reply.status(404);
      return { error: 'Source not found' };
    }

    reply.status(204);
    return;
  });
};