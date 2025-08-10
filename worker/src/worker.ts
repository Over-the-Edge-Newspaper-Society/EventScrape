import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';
import { queryClient as db } from './lib/database.js';
import { ModuleLoader } from './lib/module-loader.js';
import { BrowserPool } from './lib/browser-pool.js';
import { EventMatcher } from './lib/matcher.js';
import { normalizeEvent, RateLimiter } from './lib/utils.js';
import type { ScrapeJobData, MatchJobData, RunContext } from './types.js';
import 'dotenv/config';

const logger = pino({
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  transport: process.env.NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss Z',
      ignore: 'pid,hostname',
    }
  } : undefined,
});

class EventScraperWorker {
  private redis: IORedis;
  private scrapeWorker: Worker;
  private matchWorker: Worker;
  private moduleLoader: ModuleLoader;
  private browserPool: BrowserPool;
  private matcher: EventMatcher;
  private isShuttingDown = false;

  constructor() {
    // Initialize Redis connection
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.redis = new IORedis(redisUrl, {
      maxRetriesPerRequest: null, // Fix BullMQ deprecation warning
    });

    // Initialize components
    this.moduleLoader = new ModuleLoader();
    this.browserPool = new BrowserPool(
      3, // max browsers
      process.env.PLAYWRIGHT_HEADLESS !== 'false'
    );
    this.matcher = new EventMatcher();

    // Initialize job queues
    this.scrapeWorker = new Worker('scrape-queue', this.processScrapeJob.bind(this), {
      connection: this.redis,
      concurrency: 2,
    });

    this.matchWorker = new Worker('match-queue', this.processMatchJob.bind(this), {
      connection: this.redis,
      concurrency: 1,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.scrapeWorker.on('completed', (job) => {
      logger.info(`Scrape job ${job.id} completed`);
    });

    this.scrapeWorker.on('failed', (job, err) => {
      logger.error(`Scrape job ${job?.id} failed:`, err);
    });

    this.matchWorker.on('completed', (job) => {
      logger.info(`Match job ${job.id} completed`);
    });

    this.matchWorker.on('failed', (job, err) => {
      logger.error(`Match job ${job?.id} failed:`, err);
    });

    // Graceful shutdown
    process.on('SIGINT', () => this.shutdown('SIGINT'));
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
  }

  async initialize(): Promise<void> {
    logger.info('🚀 Initializing Event Scraper Worker...');

    try {
      // Test database connection
      await db`SELECT 1`;
      logger.info('✅ Database connected');

      // Test Redis connection
      await this.redis.ping();
      logger.info('✅ Redis connected');

      // Load scraper modules
      await this.moduleLoader.loadModules();
      logger.info(`✅ Loaded ${this.moduleLoader.getAllModules().length} scraper modules`);

      // Initialize browser pool
      await this.browserPool.initialize();
      logger.info('✅ Browser pool initialized');

      logger.info('🎉 Worker initialization complete!');
    } catch (error) {
      logger.error('❌ Worker initialization failed:', error);
      throw error;
    }
  }

  private async processScrapeJob(job: any): Promise<void> {
    const jobData = job.data as ScrapeJobData;
    logger.info(`Processing scrape job for source ${jobData.sourceId}`);

    try {
      // Get source details from database
      const result = await db`
        SELECT id, name, base_url, module_key, default_timezone, rate_limit_per_min
        FROM sources 
        WHERE id = ${jobData.sourceId} AND active = true
      `;
      const source = result[0];

      if (!source) {
        throw new Error(`Source ${jobData.sourceId} not found or inactive`);
      }

      // Get scraper module
      const module = this.moduleLoader.getModule(source.module_key);
      if (!module) {
        throw new Error(`Scraper module '${source.module_key}' not found`);
      }

      // Update run status to running
      await db`
        UPDATE runs 
        SET status = 'running' 
        WHERE id = ${jobData.runId}
      `;

      // Set up rate limiter
      const rateLimiter = new RateLimiter(source.rate_limit_per_min);

      // Get browser and page
      const { browser, page, release } = await this.browserPool.getPage();

      try {
        // Create run context
        const ctx: RunContext = {
          browser,
          page,
          sourceId: source.id,
          runId: jobData.runId,
          source: {
            id: source.id,
            name: source.name,
            baseUrl: source.base_url,
            moduleKey: source.module_key,
            defaultTimezone: source.default_timezone,
            rateLimitPerMin: source.rate_limit_per_min,
          },
          logger: logger.child({ 
            source: source.module_key, 
            runId: jobData.runId 
          }),
        };

        // Run the scraper
        await rateLimiter.waitForToken();
        const rawEvents = await module.run(ctx);

        // Process and normalize events
        const processedEvents = rawEvents.map(event => 
          normalizeEvent(event, source.default_timezone)
        );

        // Save events to database
        let savedCount = 0;
        for (const event of processedEvents) {
          try {
            await db`
              INSERT INTO events_raw (
                source_id, run_id, source_event_id, title, description_html,
                start_datetime, end_datetime, timezone, venue_name, venue_address,
                city, region, country, lat, lon, organizer, category, price, tags,
                url, image_url, scraped_at, raw, content_hash
              ) VALUES (
                ${source.id}, ${jobData.runId}, ${event.sourceEventId}, ${event.title}, ${event.descriptionHtml},
                ${event.startDatetime}, ${event.endDatetime}, ${event.timezone}, ${event.venueName}, ${event.venueAddress},
                ${event.city}, ${event.region}, ${event.country}, ${event.lat}, ${event.lon}, ${event.organizer}, 
                ${event.category}, ${event.price}, ${JSON.stringify(event.tags)},
                ${event.url}, ${event.imageUrl}, ${event.scrapedAt}, ${JSON.stringify(event.raw)}, ${event.contentHash}
              ) ON CONFLICT (source_id, source_event_id) 
              WHERE source_event_id IS NOT NULL
              DO NOTHING
            `;
            savedCount++;
          } catch (dbError) {
            logger.warn(`Failed to save event: ${dbError}`);
          }
        }

        // Update run status
        await db`
          UPDATE runs 
          SET status = 'success', finished_at = NOW(), events_found = ${savedCount}
          WHERE id = ${jobData.runId}
        `;

        logger.info(`✅ Scrape completed: ${savedCount}/${rawEvents.length} events saved`);

      } finally {
        await release();
      }

    } catch (error) {
      logger.error(`❌ Scrape job failed:`, error);
      
      // Update run status to error
      await db`
        UPDATE runs 
        SET status = 'error', finished_at = NOW(), errors_jsonb = ${JSON.stringify({ error: error.message })}
        WHERE id = ${jobData.runId}
      `;

      throw error;
    }
  }

  private async processMatchJob(job: any): Promise<void> {
    const jobData = job.data as MatchJobData;
    logger.info('Processing match job for duplicate detection');

    try {
      // Get events to analyze
      let events;
      if (jobData.sourceIds && jobData.sourceIds.length > 0) {
        if (jobData.startDate && jobData.endDate) {
          events = await db`
            SELECT id, source_id, source_event_id, title, start_datetime, end_datetime,
                   venue_name, venue_address, city, lat, lon, organizer
            FROM events_raw 
            WHERE start_datetime >= ${jobData.startDate} 
              AND start_datetime <= ${jobData.endDate}
              AND source_id = ANY(${jobData.sourceIds})
            ORDER BY start_datetime
          `;
        } else if (jobData.startDate) {
          events = await db`
            SELECT id, source_id, source_event_id, title, start_datetime, end_datetime,
                   venue_name, venue_address, city, lat, lon, organizer
            FROM events_raw 
            WHERE start_datetime >= ${jobData.startDate}
              AND source_id = ANY(${jobData.sourceIds})
            ORDER BY start_datetime
          `;
        } else if (jobData.endDate) {
          events = await db`
            SELECT id, source_id, source_event_id, title, start_datetime, end_datetime,
                   venue_name, venue_address, city, lat, lon, organizer
            FROM events_raw 
            WHERE start_datetime <= ${jobData.endDate}
              AND source_id = ANY(${jobData.sourceIds})
            ORDER BY start_datetime
          `;
        } else {
          events = await db`
            SELECT id, source_id, source_event_id, title, start_datetime, end_datetime,
                   venue_name, venue_address, city, lat, lon, organizer
            FROM events_raw 
            WHERE source_id = ANY(${jobData.sourceIds})
            ORDER BY start_datetime
          `;
        }
      } else {
        if (jobData.startDate && jobData.endDate) {
          events = await db`
            SELECT id, source_id, source_event_id, title, start_datetime, end_datetime,
                   venue_name, venue_address, city, lat, lon, organizer
            FROM events_raw 
            WHERE start_datetime >= ${jobData.startDate} 
              AND start_datetime <= ${jobData.endDate}
            ORDER BY start_datetime
          `;
        } else if (jobData.startDate) {
          events = await db`
            SELECT id, source_id, source_event_id, title, start_datetime, end_datetime,
                   venue_name, venue_address, city, lat, lon, organizer
            FROM events_raw 
            WHERE start_datetime >= ${jobData.startDate}
            ORDER BY start_datetime
          `;
        } else if (jobData.endDate) {
          events = await db`
            SELECT id, source_id, source_event_id, title, start_datetime, end_datetime,
                   venue_name, venue_address, city, lat, lon, organizer
            FROM events_raw 
            WHERE start_datetime <= ${jobData.endDate}
            ORDER BY start_datetime
          `;
        } else {
          events = await db`
            SELECT id, source_id, source_event_id, title, start_datetime, end_datetime,
                   venue_name, venue_address, city, lat, lon, organizer
            FROM events_raw 
            ORDER BY start_datetime
          `;
        }
      }

      // Find potential duplicates
      const matches = await this.matcher.findPotentialDuplicates(events);

      // Save matches to database
      for (const match of matches) {
        await db`
          INSERT INTO matches (raw_id_a, raw_id_b, score, reason, status, created_by)
          VALUES (${match.eventA}, ${match.eventB}, ${match.score}, ${JSON.stringify(match.features)}, 'open', 'system')
          ON CONFLICT DO NOTHING
        `;
      }

      logger.info(`✅ Match job completed: ${matches.length} potential duplicates found`);

    } catch (error) {
      logger.error(`❌ Match job failed:`, error);
      throw error;
    }
  }

  private async shutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    logger.info(`🛑 Received ${signal}, shutting down gracefully...`);

    try {
      // Stop accepting new jobs
      await this.scrapeWorker.close();
      await this.matchWorker.close();

      // Close browser pool
      await this.browserPool.closeAll();

      // Close Redis connection
      await this.redis.quit();

      logger.info('✅ Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  }
}

// Start the worker
const worker = new EventScraperWorker();

worker.initialize().catch((error) => {
  logger.error('Failed to start worker:', error);
  process.exit(1);
});