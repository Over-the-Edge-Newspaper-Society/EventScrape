import FirecrawlApp from '@mendable/firecrawl-js';
import type { RawEvent, RunContext } from '../types.js';

export interface FirecrawlScrapedPage {
  url: string;
  markdown?: string;
  html?: string;
  metadata?: {
    title?: string;
    description?: string;
    ogImage?: string;
    [key: string]: unknown;
  };
}

export interface FirecrawlCrawlResult {
  pages: FirecrawlScrapedPage[];
  totalPages: number;
}

/**
 * FirecrawlScraper provides an alternative to Playwright-based scraping.
 * It uses the Firecrawl API to fetch page content as clean markdown/HTML,
 * which can then be parsed by scraper modules.
 *
 * Usage modes:
 * - scrapeUrl: Fetch a single URL and get its content
 * - crawlUrl: Crawl a site starting from a URL, following links up to a limit
 * - mapUrl: Discover URLs on a website without fetching content
 */
export class FirecrawlScraper {
  private app: FirecrawlApp;
  private logger: RunContext['logger'];

  constructor(apiKey: string, logger: RunContext['logger']) {
    this.app = new FirecrawlApp({ apiKey });
    this.logger = logger;
  }

  /**
   * Scrape a single URL and return its content as markdown and/or HTML.
   */
  async scrapeUrl(url: string, options?: {
    formats?: ('markdown' | 'html')[];
    waitFor?: number;
    timeout?: number;
    actions?: Array<{ type: string; selector?: string; milliseconds?: number }>;
  }): Promise<FirecrawlScrapedPage | null> {
    try {
      this.logger.info(`[Firecrawl] Scraping URL: ${url}`);

      const response = await this.app.scrapeUrl(url, {
        formats: options?.formats || ['markdown', 'html'],
        waitFor: options?.waitFor,
        timeout: options?.timeout || 30000,
        actions: options?.actions,
      });

      if (!response.success) {
        this.logger.error(`[Firecrawl] Failed to scrape ${url}: ${(response as any).error || 'Unknown error'}`);
        return null;
      }

      return {
        url,
        markdown: response.markdown,
        html: response.html,
        metadata: response.metadata as FirecrawlScrapedPage['metadata'],
      };
    } catch (error) {
      this.logger.error(`[Firecrawl] Error scraping ${url}: ${error}`);
      return null;
    }
  }

  /**
   * Scrape multiple URLs in sequence, returning all results.
   */
  async scrapeUrls(urls: string[], options?: {
    formats?: ('markdown' | 'html')[];
    delayMs?: number;
  }): Promise<FirecrawlScrapedPage[]> {
    const results: FirecrawlScrapedPage[] = [];

    for (const url of urls) {
      const result = await this.scrapeUrl(url, { formats: options?.formats });
      if (result) {
        results.push(result);
      }

      // Delay between requests to be respectful
      if (options?.delayMs && urls.indexOf(url) < urls.length - 1) {
        await new Promise(resolve => setTimeout(resolve, options.delayMs));
      }
    }

    return results;
  }

  /**
   * Crawl a website starting from a URL. Follows links and returns all pages.
   * Useful for discovering and scraping event listing pages.
   */
  async crawlUrl(url: string, options?: {
    limit?: number;
    maxDepth?: number;
    includePaths?: string[];
    excludePaths?: string[];
    formats?: ('markdown' | 'html')[];
    pollInterval?: number;
  }): Promise<FirecrawlCrawlResult> {
    try {
      this.logger.info(`[Firecrawl] Starting crawl from: ${url} (limit: ${options?.limit || 10})`);

      const response = await this.app.crawlUrl(url, {
        limit: options?.limit || 10,
        maxDepth: options?.maxDepth,
        includePaths: options?.includePaths,
        excludePaths: options?.excludePaths,
        scrapeOptions: {
          formats: options?.formats || ['markdown', 'html'],
        },
      }, options?.pollInterval || 5000);

      if (!response.success) {
        this.logger.error(`[Firecrawl] Crawl failed for ${url}: ${(response as any).error || 'Unknown error'}`);
        return { pages: [], totalPages: 0 };
      }

      const pages: FirecrawlScrapedPage[] = (response.data || []).map((page: any) => ({
        url: page.metadata?.sourceURL || page.metadata?.url || url,
        markdown: page.markdown,
        html: page.html,
        metadata: page.metadata,
      }));

      this.logger.info(`[Firecrawl] Crawl complete: ${pages.length} pages fetched`);

      return {
        pages,
        totalPages: pages.length,
      };
    } catch (error) {
      this.logger.error(`[Firecrawl] Error crawling ${url}: ${error}`);
      return { pages: [], totalPages: 0 };
    }
  }

  /**
   * Discover URLs on a website without fetching their content.
   * Useful for finding event detail page URLs from a listing page.
   */
  async mapUrl(url: string, options?: {
    search?: string;
    limit?: number;
    includeSubdomains?: boolean;
  }): Promise<string[]> {
    try {
      this.logger.info(`[Firecrawl] Mapping URLs from: ${url}`);

      const response = await this.app.mapUrl(url, {
        search: options?.search,
        limit: options?.limit,
        includeSubdomains: options?.includeSubdomains,
      });

      if (!response.success) {
        this.logger.error(`[Firecrawl] Map failed for ${url}: ${(response as any).error || 'Unknown error'}`);
        return [];
      }

      const links = response.links || [];
      this.logger.info(`[Firecrawl] Found ${links.length} URLs`);

      return links;
    } catch (error) {
      this.logger.error(`[Firecrawl] Error mapping ${url}: ${error}`);
      return [];
    }
  }
}

/**
 * Fetch the Firecrawl API key from system_settings via a direct database query.
 * Called by the worker before creating a FirecrawlScraper instance.
 */
export async function getFirecrawlApiKey(db: any): Promise<string | null> {
  try {
    const result = await db`
      SELECT firecrawl_api_key FROM system_settings LIMIT 1
    `;
    return result[0]?.firecrawl_api_key || null;
  } catch {
    return null;
  }
}
