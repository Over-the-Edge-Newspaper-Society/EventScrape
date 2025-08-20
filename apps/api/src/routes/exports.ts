import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, desc, and, gte, lte, ilike, inArray } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { exports as exportsTable, eventsRaw, sources } from '../db/schema.js';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

const exportSchema = z.object({
  format: z.enum(['csv', 'json', 'ics', 'wp-rest']),
  filters: z.object({
    startDate: z.string().optional().transform(val => {
      if (!val) return undefined;
      // Handle both date (YYYY-MM-DD) and datetime formats
      return val.includes('T') ? val : `${val}T00:00:00.000Z`;
    }),
    endDate: z.string().optional().transform(val => {
      if (!val) return undefined;
      // Handle both date (YYYY-MM-DD) and datetime formats  
      return val.includes('T') ? val : `${val}T23:59:59.999Z`;
    }),
    city: z.string().optional(),
    category: z.string().optional(),
    sourceIds: z.array(z.string()).optional(),
    status: z.enum(['new', 'ready', 'exported', 'ignored']).optional(),
  }).default({}),
  fieldMap: z.record(z.string()).optional().default({}),
});

// Helper functions for export formats
function generateCSV(events: any[], fieldMap: Record<string, string>): string {
  if (events.length === 0) return '';

  const headers = Object.values(fieldMap);
  const rows = events.map(event => {
    return Object.keys(fieldMap).map(key => {
      let value = '';
      switch (key) {
        case 'title': value = event.title || ''; break;
        case 'description': value = event.descriptionHtml || ''; break;
        case 'start': value = event.startDatetime ? new Date(event.startDatetime).toISOString() : ''; break;
        case 'end': value = event.endDatetime ? new Date(event.endDatetime).toISOString() : ''; break;
        case 'timezone': value = event.timezone || ''; break;
        case 'venue': value = event.venueName || ''; break;
        case 'city': value = event.city || ''; break;
        case 'organizer': value = event.organizer || ''; break;
        case 'category': value = event.category || ''; break;
        case 'url': value = event.url || ''; break;
        case 'image': value = event.imageUrl || ''; break;
        default: value = '';
      }
      // Escape quotes and wrap in quotes if contains comma/quote
      return value.includes(',') || value.includes('"') || value.includes('\n') 
        ? `"${value.replace(/"/g, '""')}"` 
        : value;
    });
  });

  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
}

function generateJSON(events: any[], fieldMap: Record<string, string>): string {
  const mappedEvents = events.map(event => {
    // If fieldMap is empty or undefined, use standard field names
    const useFieldMap = fieldMap && Object.keys(fieldMap).length > 0;
    
    if (useFieldMap) {
      const mapped: any = {};
      for (const [key, csvField] of Object.entries(fieldMap)) {
        switch (key) {
          case 'title': mapped[csvField] = event.title; break;
          case 'description': mapped[csvField] = event.descriptionHtml; break;
          case 'start': mapped[csvField] = event.startDatetime; break;
          case 'end': mapped[csvField] = event.endDatetime; break;
          case 'venue': mapped[csvField] = event.venueName; break;
          case 'city': mapped[csvField] = event.city; break;
          case 'organizer': mapped[csvField] = event.organizer; break;
          case 'category': mapped[csvField] = event.category; break;
          case 'url': mapped[csvField] = event.url; break;
          case 'image': mapped[csvField] = event.imageUrl; break;
        }
      }
      return mapped;
    } else {
      // Use standard JSON structure when no field mapping
      return {
        id: event.id,
        title: event.title,
        description: event.descriptionHtml,
        startDatetime: event.startDatetime,
        endDatetime: event.endDatetime,
        timezone: event.timezone,
        venueName: event.venueName,
        venueAddress: event.venueAddress,
        city: event.city,
        organizer: event.organizer,
        category: event.category,
        url: event.url,
        imageUrl: event.imageUrl,
      };
    }
  });

  return JSON.stringify({ events: mappedEvents }, null, 2);
}

function generateICS(events: any[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//EventScrape//EventScrape//EN',
    'CALSCALE:GREGORIAN',
  ];

  for (const event of events) {
    const startDate = new Date(event.startDatetime);
    const endDate = event.endDatetime ? new Date(event.endDatetime) : new Date(startDate.getTime() + 3600000); // +1 hour default
    
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.id}@eventscrape.com`,
      `DTSTART:${formatICSDate(startDate)}`,
      `DTEND:${formatICSDate(endDate)}`,
      `SUMMARY:${escapeICS(event.title)}`,
      event.descriptionHtml ? `DESCRIPTION:${escapeICS(event.descriptionHtml.replace(/<[^>]*>/g, ''))}` : '',
      event.venueName ? `LOCATION:${escapeICS(event.venueName)}` : '',
      event.url ? `URL:${event.url}` : '',
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  return lines.filter(line => line).join('\r\n');
}

function formatICSDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escapeICS(text: string): string {
  return text.replace(/[\\,;]/g, '\\$&').replace(/\n/g, '\\n');
}

// Process export function
async function processExport(exportId: string, data: any): Promise<void> {
  // Query events based on filters
  const conditions = [];
  
  if (data.filters.startDate) {
    conditions.push(gte(eventsRaw.startDatetime, new Date(data.filters.startDate)));
  }
  if (data.filters.endDate) {
    conditions.push(lte(eventsRaw.startDatetime, new Date(data.filters.endDate)));
  }
  if (data.filters.city) {
    conditions.push(ilike(eventsRaw.city, `%${data.filters.city}%`));
  }
  if (data.filters.category) {
    conditions.push(ilike(eventsRaw.category, `%${data.filters.category}%`));
  }
  if (data.filters.sourceIds && data.filters.sourceIds.length > 0) {
    conditions.push(inArray(eventsRaw.sourceId, data.filters.sourceIds));
  }

  const events = await db
    .select({
      id: eventsRaw.id,
      title: eventsRaw.title,
      descriptionHtml: eventsRaw.descriptionHtml,
      startDatetime: eventsRaw.startDatetime,
      endDatetime: eventsRaw.endDatetime,
      timezone: eventsRaw.timezone,
      venueName: eventsRaw.venueName,
      venueAddress: eventsRaw.venueAddress,
      city: eventsRaw.city,
      organizer: eventsRaw.organizer,
      category: eventsRaw.category,
      url: eventsRaw.url,
      imageUrl: eventsRaw.imageUrl,
    })
    .from(eventsRaw)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(eventsRaw.startDatetime);

  // Ensure exports directory exists
  const exportDir = process.env.EXPORT_DIR || './exports';
  if (!existsSync(exportDir)) {
    await mkdir(exportDir, { recursive: true });
  }

  // Generate export content
  let content: string;
  let filename: string;
  let contentType: string;

  switch (data.format) {
    case 'csv':
      content = generateCSV(events, data.fieldMap);
      filename = `export-${exportId}.csv`;
      contentType = 'text/csv';
      break;
    case 'json':
      content = generateJSON(events, data.fieldMap);
      filename = `export-${exportId}.json`;
      contentType = 'application/json';
      break;
    case 'ics':
      content = generateICS(events);
      filename = `export-${exportId}.ics`;
      contentType = 'text/calendar';
      break;
    case 'wp-rest':
      // For WordPress REST, we'll generate JSON but mark it specially
      content = generateJSON(events, data.fieldMap);
      filename = `export-${exportId}-wp.json`;
      contentType = 'application/json';
      break;
    default:
      throw new Error(`Unsupported export format: ${data.format}`);
  }

  // Write file
  const filePath = join(exportDir, filename);
  await writeFile(filePath, content, 'utf8');

  // Update export record
  await db
    .update(exportsTable)
    .set({
      status: 'success',
      itemCount: events.length,
      filePath: filePath,
    })
    .where(eq(exportsTable.id, exportId));
}

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

      // Create initial export record
      const [newExport] = await db
        .insert(exportsTable)
        .values({
          format: data.format,
          itemCount: 0,
          params: {
            filters: data.filters,
            fieldMap: data.fieldMap,
          },
          status: 'success', // Will be updated after processing
        })
        .returning();

      // Process export asynchronously
      setImmediate(async () => {
        try {
          await processExport(newExport.id, data);
        } catch (error: any) {
          fastify.log.error(`Export processing failed for ${newExport.id}:`, error);
          await db
            .update(exportsTable)
            .set({
              status: 'error',
              errorMessage: error.message,
            })
            .where(eq(exportsTable.id, newExport.id));
        }
      });

      fastify.log.info(`Export job created: ${newExport.id} (${data.format})`);

      reply.status(202);
      return {
        message: 'Export job queued',
        export: newExport,
      };
    } catch (error: any) {
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

    // For now, we process synchronously, so no processing state check needed

    if (!exportRecord.filePath || !existsSync(exportRecord.filePath)) {
      reply.status(404);
      return { error: 'Export file not found' };
    }

    // Determine content type and filename
    let contentType = 'application/octet-stream';
    let filename = `export-${id}`;
    
    switch (exportRecord.format) {
      case 'csv':
        contentType = 'text/csv';
        filename += '.csv';
        break;
      case 'json':
      case 'wp-rest':
        contentType = 'application/json';
        filename += '.json';
        break;
      case 'ics':
        contentType = 'text/calendar';
        filename += '.ics';
        break;
    }

    // Read and send the file
    try {
      const fileContent = await readFile(exportRecord.filePath, 'utf8');
      
      // Set headers for file download
      reply.header('Content-Type', contentType);
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      
      return fileContent;
    } catch (error: any) {
      reply.status(500);
      return { error: 'Failed to read export file' };
    }
  });
};