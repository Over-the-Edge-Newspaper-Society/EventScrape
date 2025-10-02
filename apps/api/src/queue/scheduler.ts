import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/connection.js'
import { runs, sources, schedules, wordpressSettings, eventsRaw, exports } from '../db/schema.js'
import { enqueueScrapeJob } from './queue.js'
import { eq, gte, lte, inArray, and } from 'drizzle-orm'
import { WordPressClient } from '../services/wordpress-client.js'

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null })

// Queue used only to trigger run creation on a schedule
export const scheduleQueue = new Queue('schedule-queue', { connection })

// Worker that receives schedule triggers and creates runs
export function initScheduleWorker() {
  const worker = new Worker('schedule-queue', async (job) => {
    const { scheduleId, scheduleType, sourceId, wordpressSettingsId, config } = job.data as {
      scheduleId: string
      scheduleType: 'scrape' | 'wordpress_export'
      sourceId?: string
      wordpressSettingsId?: string
      config?: any
    }

    if (scheduleType === 'scrape' && sourceId) {
      // Load source
      const [source] = await db.select().from(sources).where(eq(sources.id, sourceId)).limit(1)
      if (!source || !source.active) {
        return
      }
      // Create run
      const runId = uuidv4()
      const [newRun] = await db.insert(runs).values({ id: runId, sourceId: source.id, status: 'queued' }).returning()
      // Enqueue scrape job
      await enqueueScrapeJob({
        sourceId: source.id,
        runId: newRun.id,
        moduleKey: source.moduleKey,
        sourceName: source.name,
      } as any)
    } else if (scheduleType === 'wordpress_export' && wordpressSettingsId) {
      // Load WordPress settings
      const [wpSettings] = await db
        .select()
        .from(wordpressSettings)
        .where(eq(wordpressSettings.id, wordpressSettingsId))
        .limit(1)

      if (!wpSettings || !wpSettings.active) {
        console.log(`WordPress settings ${wordpressSettingsId} not found or inactive`)
        return
      }

      // Build query conditions based on config
      const conditions = []
      const now = new Date()

      if (config?.startDateOffset !== undefined) {
        const startDate = new Date(now)
        startDate.setDate(startDate.getDate() + config.startDateOffset)
        conditions.push(gte(eventsRaw.startDatetime, startDate))
      }

      if (config?.endDateOffset !== undefined) {
        const endDate = new Date(now)
        endDate.setDate(endDate.getDate() + config.endDateOffset)
        conditions.push(lte(eventsRaw.startDatetime, endDate))
      }

      if (config?.sourceIds && config.sourceIds.length > 0) {
        conditions.push(inArray(eventsRaw.sourceId, config.sourceIds))
      }

      // Fetch events
      const events = await db
        .select()
        .from(eventsRaw)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(eventsRaw.startDatetime)

      if (events.length === 0) {
        console.log(`No events found for scheduled WordPress export ${scheduleId}`)
        return
      }

      // Upload to WordPress
      const client = new WordPressClient(wpSettings)
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
          status: (config?.postStatus as 'publish' | 'draft' | 'pending') || 'draft',
          updateIfExists: config?.updateIfExists || false,
          sourceCategoryMappings: wpSettings.sourceCategoryMappings as Record<string, number> || {},
        }
      )

      const successCount = results.filter((r) => r.result.success).length
      console.log(`Scheduled WordPress export completed: ${successCount}/${events.length} events uploaded`)

      // Create export record
      const createdCount = results.filter((r) => r.result.action === 'created').length
      const updatedCount = results.filter((r) => r.result.action === 'updated').length
      const skippedCount = results.filter((r) => r.result.action === 'skipped').length
      const failedCount = results.filter((r) => !r.result.success).length

      await db.insert(exports).values({
        format: 'wp-rest',
        itemCount: events.length,
        status: failedCount === events.length ? 'error' : 'success',
        errorMessage: failedCount === events.length ? 'All events failed to upload' : undefined,
        scheduleId: scheduleId,
        params: {
          wpSiteId: wordpressSettingsId,
          wpPostStatus: config?.postStatus || 'draft',
          filters: {
            startDateOffset: config?.startDateOffset,
            endDateOffset: config?.endDateOffset,
            sourceIds: config?.sourceIds,
          },
          wpResults: {
            createdCount,
            updatedCount,
            skippedCount,
            failedCount,
            results: results.map((r) => ({
              eventTitle: r.event.title,
              success: r.result.success,
              action: r.result.action,
              postUrl: r.result.postUrl,
              error: r.result.error,
            })),
          },
        },
      })
    }
  }, { connection })
  worker.on('failed', (job, err) => {
    console.error('Schedule worker failed:', job?.id, err)
  })
  return worker
}

export async function registerSchedule(schedule: {
  id: string
  scheduleType: 'scrape' | 'wordpress_export'
  sourceId?: string
  wordpressSettingsId?: string
  cron: string
  timezone?: string
  config?: any
}) {
  const jobId = `schedule:${schedule.id}`
  await scheduleQueue.add(
    'trigger',
    {
      scheduleId: schedule.id,
      scheduleType: schedule.scheduleType,
      sourceId: schedule.sourceId,
      wordpressSettingsId: schedule.wordpressSettingsId,
      config: schedule.config,
    },
    {
      jobId,
      repeat: { pattern: schedule.cron, tz: schedule.timezone || 'America/Vancouver' },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    }
  )
  // Find repeatable job key so we can remove later
  const reps = await scheduleQueue.getRepeatableJobs()
  const found = reps.find((r) => r.name === 'trigger' && r.pattern === schedule.cron && r.id === jobId)
  if (found) {
    await db.update(schedules).set({ repeatKey: found.key, updatedAt: new Date() }).where(eq(schedules.id, schedule.id))
  }
}

export async function unregisterScheduleByKey(repeatKey?: string | null) {
  if (!repeatKey) return
  try {
    await scheduleQueue.removeRepeatableByKey(repeatKey)
  } catch (e) {
    // ignore
  }
}

export async function syncSchedulesFromDb() {
  const active = await db.select().from(schedules).where(eq(schedules.active, true))
  for (const s of active) {
    await registerSchedule({
      id: s.id,
      scheduleType: s.scheduleType,
      sourceId: s.sourceId || undefined,
      wordpressSettingsId: s.wordpressSettingsId || undefined,
      cron: s.cron,
      timezone: s.timezone || undefined,
      config: s.config || undefined,
    })
  }
}
