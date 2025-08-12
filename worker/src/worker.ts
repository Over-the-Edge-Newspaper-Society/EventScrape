import { Worker, Queue } from 'bullmq';
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
  private matchQueue: Queue;
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

    // Initialize match queue for enqueueing jobs
    this.matchQueue = new Queue('match-queue', {
      connection: this.redis,
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
        // Create Redis stream writer
        const streamKey = `logs:${jobData.runId}`;
        const writeToRedisStream = (level: number, msg: string, source: string = 'worker') => {
          this.redis.xadd(
            streamKey, 
            '*', 
            'timestamp', Date.now().toString(),
            'level', level.toString(),
            'msg', msg,
            'runId', jobData.runId,
            'source', source,
            'raw', JSON.stringify({ level, msg, source, runId: jobData.runId })
          ).then(() => {
            console.log(`✅ Log written to Redis stream: ${streamKey} - ${msg}`);
          }).catch(err => {
            console.error(`❌ Failed to write log to Redis stream ${streamKey}:`, err);
          });
        };

        // Create run-specific logger
        const runLogger = pino({
          level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
        });
        
        const baseContextLogger = runLogger.child({ 
          source: source.module_key, 
          runId: jobData.runId 
        });

        // Create wrapper logger that also writes to Redis
        const contextLogger = {
          info: (msg: string) => {
            baseContextLogger.info(msg);
            writeToRedisStream(30, msg, source.module_key);
          },
          error: (msg: string) => {
            baseContextLogger.error(msg);
            writeToRedisStream(50, msg, source.module_key);
          },
          warn: (msg: string) => {
            baseContextLogger.warn(msg);
            writeToRedisStream(40, msg, source.module_key);
          },
          debug: (msg: string) => {
            baseContextLogger.debug(msg);
            writeToRedisStream(20, msg, source.module_key);
          }
        };

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
          logger: contextLogger,
          jobData: {
            testMode: jobData.testMode,
          },
          stats: {
            pagesCrawled: 0,
          },
        };

        contextLogger.info(`🚀 Starting ${jobData.testMode ? 'test' : 'full'} scrape for ${source.name}`);

        // Run the scraper
        await rateLimiter.waitForToken();
        contextLogger.info('📝 Running scraper module...');
        const rawEvents = await module.run(ctx);
        contextLogger.info(`📊 Found ${rawEvents.length} raw events`);

        // Process and normalize events
        contextLogger.info('🔄 Processing and normalizing events...');
        const processedEvents = rawEvents.map(event => 
          normalizeEvent(event, source.default_timezone)
        );
        contextLogger.info(`✅ Processed ${processedEvents.length} events`);

        // Save events to database
        contextLogger.info('💾 Saving events to database...');
        let savedCount = 0;
        for (const event of processedEvents) {
          try {
            // Debug logging: check for undefined values before database insertion
            const fieldsToCheck = {
              source_id: source.id,
              run_id: jobData.runId,
              source_event_id: event.sourceEventId,
              title: event.title,
              description_html: event.descriptionHtml,
              start_datetime: event.startDatetime,
              end_datetime: event.endDatetime,
              timezone: event.timezone,
              venue_name: event.venueName,
              venue_address: event.venueAddress,
              city: event.city,
              region: event.region,
              country: event.country,
              lat: event.lat,
              lon: event.lon,
              organizer: event.organizer,
              category: event.category,
              price: event.price,
              tags: event.tags,
              url: event.url,
              image_url: event.imageUrl,
              scraped_at: event.scrapedAt,
              raw: event.raw,
              content_hash: event.contentHash
            };

            const undefinedFields = Object.entries(fieldsToCheck)
              .filter(([key, value]) => value === undefined)
              .map(([key]) => key);

            if (undefinedFields.length > 0) {
              contextLogger.warn(`Event "${event.title}" has undefined fields: ${undefinedFields.join(', ')}`);
              contextLogger.debug('Full event object:', JSON.stringify(event, null, 2));
            }

            await db`
              INSERT INTO events_raw (
                source_id, run_id, source_event_id, title, description_html,
                start_datetime, end_datetime, timezone, venue_name, venue_address,
                city, region, country, lat, lon, organizer, category, price, tags,
                url, image_url, scraped_at, raw, content_hash
              ) VALUES (
                ${source.id}, ${jobData.runId}, ${event.sourceEventId || null}, ${event.title}, ${event.descriptionHtml || null},
                ${event.startDatetime}, ${event.endDatetime || null}, ${event.timezone}, ${event.venueName || null}, ${event.venueAddress || null},
                ${event.city || null}, ${event.region || null}, ${event.country || null}, ${event.lat || null}, ${event.lon || null}, ${event.organizer || null}, 
                ${event.category || null}, ${event.price || null}, ${event.tags ? JSON.stringify(event.tags) : null},
                ${event.url}, ${event.imageUrl || null}, ${event.scrapedAt}, ${JSON.stringify(event.raw)}, ${event.contentHash}
              ) ON CONFLICT (source_id, source_event_id) 
              WHERE source_event_id IS NOT NULL
              DO NOTHING
            `;
            savedCount++;
          } catch (dbError) {
            contextLogger.warn(`Failed to save event "${event.title}": ${dbError}`);
            contextLogger.debug('Event that failed to save:', JSON.stringify(event, null, 2));
          }
        }

        // Update run status
        contextLogger.info('🎯 Updating run status...');
        const pagesCrawled = ctx.stats?.pagesCrawled || 0;
        await db`
          UPDATE runs 
          SET status = 'success', finished_at = NOW(), events_found = ${savedCount}, pages_crawled = ${pagesCrawled}
          WHERE id = ${jobData.runId}
        `;

        contextLogger.info(`🎉 Scrape completed successfully! Saved ${savedCount}/${rawEvents.length} events`);
        contextLogger.info(`✅ Scrape completed: ${savedCount}/${rawEvents.length} events saved`);

        // Queue a match job to find duplicates for recently scraped events
        if (savedCount > 0) {
          contextLogger.info('🔍 Queuing duplicate detection job...');
          const matchJobData: MatchJobData = {
            sourceIds: [source.id],
            // Only check events from the last 30 days to keep it manageable
            startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          };
          
          await this.matchQueue.add('match', matchJobData, {
            jobId: `match-after-scrape-${jobData.runId}`,
            delay: 5000, // Wait 5 seconds to let any database operations complete
          });
          
          contextLogger.info('✅ Duplicate detection job queued');
        }

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
    logger.info('Processing match job for duplicate detection', { jobData });

    try {
      logger.info('Starting match job processing...');
      logger.info('Match job data:', JSON.stringify(jobData));
      
      // Get events to analyze
      let events;
      if (jobData.sourceIds && Array.isArray(jobData.sourceIds) && jobData.sourceIds.length > 0) {
        logger.info('Using source-specific queries');
        if (jobData.startDate && jobData.endDate) {
          logger.info('Query: with sourceIds, startDate, and endDate');
          events = await db`
            SELECT DISTINCT e.id, e.source_id as "sourceId", e.source_event_id as "sourceEventId", 
                   e.title, e.start_datetime as "startDatetime", e.end_datetime as "endDatetime",
                   e.venue_name as "venueName", e.venue_address as "venueAddress", 
                   e.city, e.lat, e.lon, e.organizer, e.category
            FROM events_raw e
            WHERE e.start_datetime >= ${jobData.startDate} 
              AND e.start_datetime <= ${jobData.endDate}
              AND e.source_id = ANY(${jobData.sourceIds})
            ORDER BY e.start_datetime
          `;
        } else if (jobData.startDate) {
          events = await db`
            SELECT DISTINCT e.id, e.source_id as "sourceId", e.source_event_id as "sourceEventId", 
                   e.title, e.start_datetime as "startDatetime", e.end_datetime as "endDatetime",
                   e.venue_name as "venueName", e.venue_address as "venueAddress", 
                   e.city, e.lat, e.lon, e.organizer, e.category
            FROM events_raw e
            WHERE e.start_datetime >= ${jobData.startDate}
              AND e.source_id = ANY(${jobData.sourceIds})
            ORDER BY e.start_datetime
          `;
        } else if (jobData.endDate) {
          events = await db`
            SELECT DISTINCT e.id, e.source_id as "sourceId", e.source_event_id as "sourceEventId", 
                   e.title, e.start_datetime as "startDatetime", e.end_datetime as "endDatetime",
                   e.venue_name as "venueName", e.venue_address as "venueAddress", 
                   e.city, e.lat, e.lon, e.organizer, e.category
            FROM events_raw e
            WHERE e.start_datetime <= ${jobData.endDate}
              AND e.source_id = ANY(${jobData.sourceIds})
            ORDER BY e.start_datetime
          `;
        } else {
          events = await db`
            SELECT DISTINCT e.id, e.source_id as "sourceId", e.source_event_id as "sourceEventId", 
                   e.title, e.start_datetime as "startDatetime", e.end_datetime as "endDatetime",
                   e.venue_name as "venueName", e.venue_address as "venueAddress", 
                   e.city, e.lat, e.lon, e.organizer, e.category
            FROM events_raw e
            WHERE e.source_id = ANY(${jobData.sourceIds})
            ORDER BY e.start_datetime
          `;
        }
      } else {
        logger.info('Using all-sources queries');
        if (jobData.startDate && jobData.endDate) {
          logger.info('Query: all sources with startDate and endDate');
          events = await db`
            SELECT DISTINCT e.id, e.source_id as "sourceId", e.source_event_id as "sourceEventId", 
                   e.title, e.start_datetime as "startDatetime", e.end_datetime as "endDatetime",
                   e.venue_name as "venueName", e.venue_address as "venueAddress", 
                   e.city, e.lat, e.lon, e.organizer, e.category
            FROM events_raw e
            WHERE e.start_datetime >= ${jobData.startDate} 
              AND e.start_datetime <= ${jobData.endDate}
            ORDER BY e.start_datetime
          `;
        } else if (jobData.startDate) {
          events = await db`
            SELECT DISTINCT e.id, e.source_id as "sourceId", e.source_event_id as "sourceEventId", 
                   e.title, e.start_datetime as "startDatetime", e.end_datetime as "endDatetime",
                   e.venue_name as "venueName", e.venue_address as "venueAddress", 
                   e.city, e.lat, e.lon, e.organizer, e.category
            FROM events_raw e
            WHERE e.start_datetime >= ${jobData.startDate}
            ORDER BY e.start_datetime
          `;
        } else if (jobData.endDate) {
          events = await db`
            SELECT DISTINCT e.id, e.source_id as "sourceId", e.source_event_id as "sourceEventId", 
                   e.title, e.start_datetime as "startDatetime", e.end_datetime as "endDatetime",
                   e.venue_name as "venueName", e.venue_address as "venueAddress", 
                   e.city, e.lat, e.lon, e.organizer, e.category
            FROM events_raw e
            WHERE e.start_datetime <= ${jobData.endDate}
            ORDER BY e.start_datetime
          `;
        } else {
          events = await db`
            SELECT DISTINCT e.id, e.source_id as "sourceId", e.source_event_id as "sourceEventId", 
                   e.title, e.start_datetime as "startDatetime", e.end_datetime as "endDatetime",
                   e.venue_name as "venueName", e.venue_address as "venueAddress", 
                   e.city, e.lat, e.lon, e.organizer, e.category
            FROM events_raw e
            ORDER BY e.start_datetime
          `;
        }
      }

      logger.info(`Found ${events.length} events to analyze for duplicates`);
      
      // Clear existing open matches to avoid accumulation
      logger.info('Clearing existing open matches...');
      const deletedCount = await db`
        DELETE FROM matches WHERE status = 'open'
      `;
      logger.info(`Cleared ${deletedCount.count} existing open matches`);
      
      // Find potential duplicates (cast to EventRaw[] for matcher compatibility)
      const matches = await this.matcher.findPotentialDuplicates(events as EventRaw[]);
      
      logger.info(`Matcher found ${matches.length} potential duplicates`);

      // Save matches to database
      let savedMatches = 0;
      for (const match of matches) {
        try {
          await db`
            INSERT INTO matches (raw_id_a, raw_id_b, score, reason, status, created_by)
            VALUES (${match.eventA}, ${match.eventB}, ${match.score}, ${JSON.stringify(match.features)}, 'open', 'system')
            ON CONFLICT DO NOTHING
          `;
          savedMatches++;
        } catch (dbError) {
          logger.error(`Failed to save match: ${dbError}`, { match });
        }
      }

      logger.info(`✅ Match job completed: ${matches.length} potential duplicates found, ${savedMatches} saved to database`);

    } catch (error) {
      const errorMessage = (error as Error).message;
      const errorStack = (error as Error).stack;
      logger.error(`❌ Match job failed with error: ${errorMessage}`);
      console.error('❌ Match job full error:', error);
      console.error('❌ Error stack:', errorStack);
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
      await this.matchQueue.close();

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