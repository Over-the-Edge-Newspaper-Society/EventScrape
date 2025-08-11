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
});

const updateSourceSchema = createSourceSchema.partial();

// Helper function to load available modules from worker
async function loadAvailableModules(): Promise<Array<{key: string, label: string, baseUrl: string}>> {
  const modules: Array<{key: string, label: string, baseUrl: string}> = [];
  
  // Path to worker modules directory
  const modulesPath = resolve(process.cwd(), '../../worker/src/modules');
  
  try {
    const entries = await readdir(modulesPath, { withFileTypes: true });
    const moduleDirs = entries.filter(entry => entry.isDirectory());

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
      } catch (error) {
        console.error(`Failed to load module info for ${dir.name}:`, error);
      }
    }
  } catch (error) {
    console.error('Failed to read modules directory:', error);
  }
  
  return modules;
}

export const sourcesRoutes: FastifyPluginAsync = async (fastify) => {
  // Get all sources
  fastify.get('/', async () => {
    const allSources = await db.select().from(sources);
    return { sources: allSources };
  });

  // Sync available modules with database
  fastify.post('/sync', async (_, reply) => {
    try {
      const availableModules = await loadAvailableModules();
      const existingSources = await db.select().from(sources);
      
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
          await db
            .update(sources)
            .set({ 
              active: true, 
              updatedAt: new Date(),
              notes: existingSource.notes ? `${existingSource.notes} (Reactivated from available module)` : 'Reactivated from available module'
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
        await db
          .update(sources)
          .set({ 
            active: false, 
            updatedAt: new Date(),
            notes: orphan.notes ? `${orphan.notes} (Deactivated - module not found)` : 'Deactivated - module not found'
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
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
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