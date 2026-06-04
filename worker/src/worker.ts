import pino from 'pino';
import { ModuleLoader } from './lib/module-loader.js';
import { BrowserPool } from './lib/browser-pool.js';
import { EventMatcher } from './lib/matcher.js';
import { normalizeEvent, RateLimiter } from './lib/utils.js';
import { persistScrapedEvent } from './lib/occurrence-db.js';
import { jobs, workerApi, appendRunLog, type ClaimedJob } from './lib/convex.js';
import type { ScrapeJobData, MatchJobData, RunContext, JobShim } from './types.js';
import { handleInstagramScrapeJob } from './modules/instagram/instagram-job.js';
import { handleReviewAiJob } from './jobs/reviewAi.js';
import { handlePosterImportJob } from './jobs/posterImport.js';
import { handleApifyImportJob } from './jobs/apifyImport.js';
import type { EventRaw } from './lib/database.js';
import 'dotenv/config';

const logger = pino({
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  transport: process.env.NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
  } : undefined,
});

const WORKER_ID = `worker-${process.pid}`;
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS || 1500);

// Queue concurrency limits (parity with the old BullMQ worker config).
const QUEUE_CONCURRENCY: Record<string, number> = {
  scrape: 2,
  match: 1,
  instagramScrape: 1,
  review: 1,
  posterImport: 1,
  apifyImport: 1,
  moduleSync: 1,
};

class EventScraperWorker {
  private moduleLoader = new ModuleLoader();
  private browserPool = new BrowserPool(3, process.env.PLAYWRIGHT_HEADLESS !== 'false');
  private matcher = new EventMatcher();
  private active: Record<string, number> = { scrape: 0, match: 0, instagramScrape: 0 };
  private isShuttingDown = false;
  private inFlight = new Set<Promise<void>>();

  async initialize(): Promise<void> {
    logger.info('🚀 Initializing Event Scraper Worker (Convex mode)...');
    await this.moduleLoader.loadModules();
    logger.info(`✅ Loaded ${this.moduleLoader.getAllModules().length} scraper modules`);
    // Push discovered modules to Convex so the source rows stay current. The
    // browser can't read the worker's module dir, so the worker owns discovery.
    await this.syncModules();
    // Browser-pool init is non-fatal: match jobs and Apify-based Instagram jobs
    // don't need Playwright. Website scrape jobs will fail individually (and be
    // retried) if the browser can't launch, rather than taking down the worker.
    try {
      await this.browserPool.initialize();
      logger.info('✅ Browser pool initialized');
    } catch (err) {
      logger.warn(`⚠️  Browser pool init failed (website scrapes disabled): ${(err as Error).message}`);
    }

    process.on('SIGINT', () => this.shutdown('SIGINT'));
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));

    logger.info('🎉 Worker ready — polling Convex job queues');
    this.pollLoop();
  }

  private async pollLoop(): Promise<void> {
    let lastReclaim = 0;
    while (!this.isShuttingDown) {
      // Periodically reclaim jobs stranded by a crashed worker.
      if (Date.now() - lastReclaim > 60_000) {
        lastReclaim = Date.now();
        try {
          const { requeued, failed } = await jobs.reclaimStalled({});
          if (requeued || failed) logger.warn(`♻️  Reclaimed stalled jobs: ${requeued} requeued, ${failed} failed`);
        } catch (err) {
          logger.error(`reclaimStalled failed: ${(err as Error).message}`);
        }
      }
      let claimedAny = false;
      for (const queue of Object.keys(QUEUE_CONCURRENCY)) {
        if (this.active[queue] >= QUEUE_CONCURRENCY[queue]) continue;
        try {
          const job = (await jobs.claimNext({ queue, workerId: WORKER_ID })) as ClaimedJob;
          if (job) {
            claimedAny = true;
            this.dispatch(job);
          }
        } catch (err) {
          logger.error(`Failed to claim from ${queue}: ${(err as Error).message}`);
        }
      }
      // Back off when idle to avoid hammering the backend.
      if (!claimedAny) await sleep(POLL_INTERVAL_MS);
    }
  }

  private dispatch(job: NonNullable<ClaimedJob>): void {
    this.active[job.queue]++;
    const task = this.runJob(job).finally(() => {
      this.active[job.queue]--;
      this.inFlight.delete(task);
    });
    this.inFlight.add(task);
  }

  private async runJob(job: NonNullable<ClaimedJob>): Promise<void> {
    logger.info(`▶️  Claimed ${job.queue} job ${job._id}`);
    try {
      if (job.queue === 'scrape') await this.processScrapeJob(job);
      else if (job.queue === 'match') await this.processMatchJob(job);
      else if (job.queue === 'instagramScrape') await this.processInstagramScrapeJob(job);
      else if (job.queue === 'review') await handleReviewAiJob(this.shim(job));
      else if (job.queue === 'posterImport') await handlePosterImportJob(this.shim(job));
      else if (job.queue === 'apifyImport') await handleApifyImportJob(this.shim(job));
      else if (job.queue === 'moduleSync') await this.syncModules();
      else throw new Error(`Unknown queue ${job.queue}`);

      await jobs.complete({ jobId: job._id });
      logger.info(`✅ ${job.queue} job ${job._id} completed`);
    } catch (error) {
      const message = (error as Error).message || String(error);
      logger.error(`❌ ${job.queue} job ${job._id} failed: ${message}`);
      // jobs.fail handles retry vs final-error (and marks the run on final failure).
      await jobs.fail({ jobId: job._id, error: message }).catch((e) =>
        logger.error(`Failed to mark job failed: ${(e as Error).message}`),
      );
    }
  }

  private async processScrapeJob(job: NonNullable<ClaimedJob>): Promise<void> {
    const jobData = job.payload as ScrapeJobData;
    const runId = jobData.runId;
    const source = await workerApi.getSource({ sourceId: jobData.sourceId });
    if (!source || !source.active) {
      throw new Error(`Source ${jobData.sourceId} not found or inactive`);
    }

    const module = this.moduleLoader.getModule(source.moduleKey);
    if (!module) throw new Error(`Scraper module '${source.moduleKey}' not found`);

    await workerApi.markRunRunning({ runId });

    const rateLimiter = new RateLimiter(source.rateLimitPerMin);
    const { browser, page, release } = await this.browserPool.getPage();

    const mkLog = (level: number) => (msg: string) => {
      if (level >= 50) logger.error(msg);
      else if (level >= 40) logger.warn(msg);
      else logger.info(msg);
      void appendRunLog(runId, level, msg, source.moduleKey);
    };
    const contextLogger = {
      info: mkLog(30),
      error: mkLog(50),
      warn: mkLog(40),
      debug: mkLog(20),
    };

    try {
      const ctx: RunContext = {
        browser,
        page,
        sourceId: source._id,
        runId,
        source: {
          id: source._id,
          name: source.name,
          baseUrl: source.baseUrl,
          moduleKey: source.moduleKey,
          defaultTimezone: source.defaultTimezone,
          rateLimitPerMin: source.rateLimitPerMin,
        },
        logger: contextLogger,
        jobData: {
          testMode: jobData.testMode,
          scrapeMode: jobData.scrapeMode,
          paginationOptions: jobData.paginationOptions,
          uploadedFile: (jobData as any).uploadedFile,
          sourceId: jobData.sourceId,
          runId,
        },
        stats: { pagesCrawled: 0 },
      };

      contextLogger.info(`🚀 Starting ${jobData.testMode ? 'test' : 'full'} scrape for ${source.name}`);
      await rateLimiter.waitForToken();
      contextLogger.info('📝 Running scraper module...');
      const rawEvents = await module.run(ctx);
      contextLogger.info(`📊 Found ${rawEvents.length} raw events`);

      const processedEvents = rawEvents.map((event) =>
        normalizeEvent(event, source.defaultTimezone),
      );
      contextLogger.info(`✅ Processed ${processedEvents.length} events`);

      contextLogger.info('💾 Saving events to Convex (series + occurrences)...');
      let savedCount = 0;
      const counters = { processed: 0, inserted: 0, updated: 0, unchanged: 0, failed: 0 };
      for (const event of processedEvents) {
        try {
          counters.processed++;
          const { action } = await persistScrapedEvent(event, source._id, runId);
          if (action === 'inserted') { counters.inserted++; savedCount++; }
          else if (action === 'updated') { counters.updated++; savedCount++; }
          else counters.unchanged++;

          const seriesDates = event.raw?.seriesDates;
          if (Array.isArray(seriesDates) && seriesDates.length > 1) {
            contextLogger.info(`📅 Series event "${event.title}": ${seriesDates.length} occurrences`);
          }
        } catch (dbError) {
          contextLogger.warn(`Failed to save event "${event.title}": ${dbError}`);
          counters.failed++;
        }
      }

      const pagesCrawled = ctx.stats?.pagesCrawled || 0;
      await workerApi.finishRun({
        runId,
        status: 'success',
        eventsFound: savedCount,
        pagesCrawled,
      });

      contextLogger.info(`🎉 Scrape completed: ${savedCount}/${rawEvents.length} inserts/updates`);
      contextLogger.info(
        `📊 processed: ${counters.processed}, inserted: ${counters.inserted}, updated: ${counters.updated}, unchanged: ${counters.unchanged}, failed: ${counters.failed}`,
      );

      // Enqueue a follow-up match job for recently scraped events.
      if (savedCount > 0) {
        contextLogger.info('🔍 Queuing duplicate detection job...');
        const matchPayload: MatchJobData = {
          sourceIds: [source._id],
          startMs: Date.now() - 30 * 24 * 60 * 60 * 1000,
        } as any;
        await jobs.enqueue({
          queue: 'match',
          name: 'match-after-scrape',
          payload: matchPayload,
          delayMs: 5000,
        });
        contextLogger.info('✅ Duplicate detection job queued');
      }
    } finally {
      await release();
    }
  }

  private async processMatchJob(job: NonNullable<ClaimedJob>): Promise<void> {
    const jobData = (job.payload || {}) as MatchJobData & { startMs?: number; endMs?: number };
    logger.info('Processing match job for duplicate detection');

    const events = await workerApi.eventsForMatching({
      sourceIds: jobData.sourceIds,
      startMs: jobData.startMs,
      endMs: jobData.endMs,
    });
    logger.info(`Found ${events.length} events to analyze for duplicates`);

    const matches = await this.matcher.findPotentialDuplicates(events as unknown as EventRaw[]);
    logger.info(`Matcher found ${matches.length} potential duplicates`);

    const { cleared, inserted } = await workerApi.replaceOpenMatches({
      matches: matches.map((mt) => ({
        rawIdA: mt.eventA,
        rawIdB: mt.eventB,
        score: mt.score,
        reason: mt.features,
      })),
    });
    logger.info(`✅ Match job completed: cleared ${cleared} open, inserted ${inserted}`);
  }

  // Discover scraper modules and sync the Convex source rows.
  private async syncModules(): Promise<void> {
    try {
      const modules = this.moduleLoader.getAllModules().map((m) => ({
        key: m.key,
        label: m.label,
        baseUrl: m.startUrls?.[0] || '',
      }));
      const res = await workerApi.syncFromModules({ modules });
      logger.info(
        `🔄 Synced ${modules.length} modules to Convex (created ${res.stats?.created ?? 0}, updated ${res.stats?.updated ?? 0}, deactivated ${res.stats?.deactivated ?? 0})`,
      );
    } catch (err) {
      logger.error(`Module sync failed: ${(err as Error).message}`);
    }
  }

  // Build a JobShim for the generic job handlers (wordpress/review/poster/apify).
  private shim(job: NonNullable<ClaimedJob>): JobShim {
    const runId = (job.payload as { runId?: string })?.runId || job.runId;
    return {
      id: job._id,
      data: job.payload,
      runId,
      log: (msg: string) => {
        logger.info(`[${job.queue}] ${msg}`);
        if (runId) void appendRunLog(runId, 30, msg, job.queue);
      },
      updateProgress: async () => {},
    };
  }

  private async processInstagramScrapeJob(job: NonNullable<ClaimedJob>): Promise<void> {
    const payload = job.payload as { runId?: string };
    const shim: JobShim = {
      id: job._id,
      data: job.payload,
      runId: payload.runId,
      log: (msg: string) => {
        logger.info(`[ig] ${msg}`);
        if (payload.runId) void appendRunLog(payload.runId, 30, msg, 'instagram');
      },
      updateProgress: async () => {},
    };
    await handleInstagramScrapeJob(shim);
  }

  private async shutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    logger.info(`🛑 Received ${signal}, shutting down gracefully...`);
    try {
      await Promise.allSettled([...this.inFlight]);
      await this.browserPool.closeAll();
      logger.info('✅ Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const worker = new EventScraperWorker();
worker.initialize().catch((error) => {
  logger.error('Failed to start worker:', error);
  process.exit(1);
});
