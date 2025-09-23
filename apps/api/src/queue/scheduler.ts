import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/connection.js'
import { runs, sources, schedules } from '../db/schema.js'
import { enqueueScrapeJob } from './queue.js'
import { eq } from 'drizzle-orm'

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null })

// Queue used only to trigger run creation on a schedule
export const scheduleQueue = new Queue('schedule-queue', { connection })

// Worker that receives schedule triggers and creates runs
export function initScheduleWorker() {
  const worker = new Worker('schedule-queue', async (job) => {
    const { sourceId } = job.data as { scheduleId: string; sourceId: string }
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
  }, { connection })
  worker.on('failed', (job, err) => {
    console.error('Schedule worker failed:', job?.id, err)
  })
  return worker
}

export async function registerSchedule(schedule: { id: string, sourceId: string, cron: string, timezone?: string }) {
  const jobId = `schedule:${schedule.id}`
  await scheduleQueue.add('trigger', { scheduleId: schedule.id, sourceId: schedule.sourceId }, {
    jobId,
    repeat: { pattern: schedule.cron, tz: schedule.timezone || 'America/Vancouver' },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  })
  // Find repeatable job key so we can remove later
  const reps = await scheduleQueue.getRepeatableJobs()
  const found = reps.find(r => r.name === 'trigger' && r.pattern === schedule.cron && r.id === jobId)
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
    await registerSchedule({ id: s.id, sourceId: s.sourceId, cron: s.cron, timezone: s.timezone || undefined })
  }
}
