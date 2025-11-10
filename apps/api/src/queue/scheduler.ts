import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/connection.js'
import { runs, sources, schedules, wordpressSettings, exports } from '../db/schema.js'
import { enqueueScrapeJob } from './queue.js'
import { eq } from 'drizzle-orm'
import { processExport } from '../routes/exports.js'
import { triggerInstagramScrapeSchedule } from '../services/instagram-scrape.js'

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null })

// Queue used only to trigger run creation on a schedule
export const scheduleQueue = new Queue('schedule-queue', { connection })

const PROMOTE_INTERVAL_MS = Number(process.env.SCHEDULE_PROMOTE_INTERVAL_MS ?? 5000)
const PROMOTE_LOOKAHEAD_MS = Number(process.env.SCHEDULE_PROMOTE_LOOKAHEAD_MS ?? 1000)
const PROMOTE_BATCH_SIZE = Number(process.env.SCHEDULE_PROMOTE_BATCH_SIZE ?? 50)
const SYNC_INTERVAL_MS = Number(process.env.SCHEDULE_SYNC_INTERVAL_MS ?? 60000)
const DEFAULT_TIMEZONE = 'America/Vancouver'

let promoteTimer: NodeJS.Timeout | null = null
let syncTimer: NodeJS.Timeout | null = null
let syncInProgress = false

async function promoteDueScheduleJobs() {
  try {
    const delayedJobs = await scheduleQueue.getDelayed(0, PROMOTE_BATCH_SIZE - 1)
    if (!delayedJobs.length) {
      return
    }

    const now = Date.now()
    for (const job of delayedJobs) {
      const scheduledAt = (job.timestamp ?? 0) + (job.delay ?? 0)

      if (!scheduledAt) {
        continue
      }

      if (scheduledAt - PROMOTE_LOOKAHEAD_MS > now) {
        continue
      }

      try {
        await job.promote()
        if (typeof console.debug === 'function') {
          console.debug(`Promoted scheduled job ${job.id} for execution`)
        }
      } catch (error: any) {
        // Ignore errors for jobs that have already been promoted
        if (typeof error?.message === 'string' && error.message.includes('Job is not in a delayed state')) {
          continue
        }
        console.error('Failed to promote scheduled job', job?.id, error)
      }
    }
  } catch (error) {
    console.error('Failed to scan delayed schedule jobs', error)
  }
}

function ensurePromotionLoop() {
  if (promoteTimer) {
    return
  }

  promoteTimer = setInterval(() => {
    void promoteDueScheduleJobs()
  }, PROMOTE_INTERVAL_MS)

  if (typeof promoteTimer.unref === 'function') {
    promoteTimer.unref()
  }

  // Kick off an initial scan so overdue jobs run quickly after startup
  void promoteDueScheduleJobs()
}

function ensureScheduleSyncLoop() {
  if (SYNC_INTERVAL_MS <= 0) {
    return
  }

  if (syncTimer) {
    return
  }

  syncTimer = setInterval(() => {
    void syncSchedulesFromDb()
  }, SYNC_INTERVAL_MS)

  if (typeof syncTimer.unref === 'function') {
    syncTimer.unref()
  }

  // Run an initial sync in case schedules changed while the service was down
  void syncSchedulesFromDb()
}

// Worker that receives schedule triggers and creates runs
export function initScheduleWorker() {
  ensurePromotionLoop()
  ensureScheduleSyncLoop()

  const worker = new Worker('schedule-queue', async (job) => {
    const { scheduleId, scheduleType, sourceId, wordpressSettingsId, config } = job.data as {
      scheduleId: string
      scheduleType: 'scrape' | 'wordpress_export' | 'instagram_scrape'
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

      // Create export record with "processing" status first
      const [exportRecord] = await db.insert(exports).values({
        format: 'wp-rest',
        itemCount: 0,
        status: 'processing',
        scheduleId: scheduleId,
        params: {
          filters: {},
          fieldMap: {},
        },
      }).returning()

      // Calculate date filters
      const now = new Date()
      let startDate: string | undefined
      let endDate: string | undefined

      if (config?.startDateOffset !== undefined) {
        const start = new Date(now)
        start.setDate(start.getDate() + config.startDateOffset)
        startDate = start.toISOString()
      }

      if (config?.endDateOffset !== undefined) {
        const end = new Date(now)
        end.setDate(end.getDate() + config.endDateOffset)
        endDate = end.toISOString()
      }

      // Use the shared processExport function
      try {
        await processExport(exportRecord.id, {
          format: 'wp-rest',
          wpSiteId: wordpressSettingsId,
          status: config?.status || 'draft',
          filters: {
            startDate,
            endDate,
            sourceIds: config?.sourceIds || [],
          },
          fieldMap: {},
        })
        console.log(`Scheduled WordPress export completed for schedule ${scheduleId}`)
      } catch (error: any) {
        console.error(`Scheduled WordPress export failed for schedule ${scheduleId}:`, error)
        throw error
      }
    } else if (scheduleType === 'instagram_scrape') {
      const scheduleConfig = (config && typeof config === 'object') ? { ...config } : {}
      await triggerInstagramScrapeSchedule({ ...scheduleConfig, scheduleId })
    }
  }, { connection })
  worker.on('failed', (job, err) => {
    console.error('Schedule worker failed:', job?.id, err)
  })
  worker.on('completed', (job) => {
    if (typeof console.info === 'function') {
      console.info(`Schedule worker completed job ${job.id}`)
    }
  })
  return worker
}

export async function registerSchedule(schedule: {
  id: string
  scheduleType: 'scrape' | 'wordpress_export' | 'instagram_scrape'
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
      repeat: { pattern: schedule.cron, tz: schedule.timezone || DEFAULT_TIMEZONE },
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

export async function unregisterScheduleByKey(
  repeatKey?: string | null,
  fallback?: { scheduleId: string; cron: string; timezone?: string | null }
) {
  if (repeatKey) {
    try {
      await scheduleQueue.removeRepeatableByKey(repeatKey)
      return
    } catch (error) {
      console.warn('Failed to remove schedule via repeatKey, attempting fallback removal', error)
    }
  }

  if (!fallback) return

  try {
    await scheduleQueue.removeRepeatable(
      'trigger',
      {
        pattern: fallback.cron,
        tz: fallback.timezone || DEFAULT_TIMEZONE,
      },
      `schedule:${fallback.scheduleId}`
    )
  } catch (error) {
    console.warn('Failed to remove schedule via fallback cron removal', error)
  }
}

export async function syncSchedulesFromDb() {
  if (syncInProgress) {
    return
  }

  syncInProgress = true
  try {
    const [allSchedules, repeatableJobs] = await Promise.all([
      db.select().from(schedules),
      scheduleQueue.getRepeatableJobs(0, -1),
    ])

    const schedulesById = new Map(allSchedules.map((schedule) => [schedule.id, schedule]))
    const repeatsByJobId = new Map(repeatableJobs.map((repeat) => [repeat.id, repeat]))

    for (const schedule of allSchedules) {
      const jobId = `schedule:${schedule.id}`
      const repeatJob = repeatsByJobId.get(jobId)

      if (schedule.active) {
        const desiredPattern = schedule.cron
        const desiredTimezone = schedule.timezone || DEFAULT_TIMEZONE
        const repeatTimezone = repeatJob?.tz ?? DEFAULT_TIMEZONE

        const needsRegister = !repeatJob || repeatJob.pattern !== desiredPattern || repeatTimezone !== desiredTimezone

        if (needsRegister) {
          if (repeatJob) {
            await unregisterScheduleByKey(repeatJob.key)
            repeatsByJobId.delete(jobId)
          }

          await registerSchedule({
            id: schedule.id,
            scheduleType: schedule.scheduleType,
            sourceId: schedule.sourceId || undefined,
            wordpressSettingsId: schedule.wordpressSettingsId || undefined,
            cron: schedule.cron,
            timezone: schedule.timezone || undefined,
            config: schedule.config || undefined,
          })
        } else {
          if (!schedule.repeatKey || schedule.repeatKey !== repeatJob.key) {
            await db
              .update(schedules)
              .set({ repeatKey: repeatJob.key, updatedAt: new Date() })
              .where(eq(schedules.id, schedule.id))
          }
          repeatsByJobId.delete(jobId)
        }
      } else {
        if (repeatJob) {
          await unregisterScheduleByKey(repeatJob.key)
          repeatsByJobId.delete(jobId)
        }

        if (schedule.repeatKey) {
          await db
            .update(schedules)
            .set({ repeatKey: null, updatedAt: new Date() })
            .where(eq(schedules.id, schedule.id))
        }
      }
    }

    for (const repeatJob of repeatsByJobId.values()) {
      await unregisterScheduleByKey(repeatJob.key)
      const scheduleId = repeatJob.id?.startsWith('schedule:') ? repeatJob.id.slice('schedule:'.length) : repeatJob.id
      if (scheduleId && schedulesById.has(scheduleId)) {
        const schedule = schedulesById.get(scheduleId)!
        if (schedule.repeatKey) {
          await db
            .update(schedules)
            .set({ repeatKey: null, updatedAt: new Date() })
            .where(eq(schedules.id, schedule.id))
        }
      }
    }
  } catch (error) {
    console.error('Failed to sync schedules from DB', error)
  } finally {
    syncInProgress = false
  }
}

export async function triggerScheduleNow(data: {
  scheduleId: string
  scheduleType: 'scrape' | 'wordpress_export' | 'instagram_scrape'
  sourceId?: string
  wordpressSettingsId?: string
  config?: any
}) {
  // Add job to queue to trigger immediately (no repeat)
  await scheduleQueue.add(
    'trigger-manual',
    {
      scheduleId: data.scheduleId,
      scheduleType: data.scheduleType,
      sourceId: data.sourceId,
      wordpressSettingsId: data.wordpressSettingsId,
      config: data.config,
    },
    {
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    }
  )
}
