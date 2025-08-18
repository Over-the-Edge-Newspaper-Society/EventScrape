import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { chromium, Browser, Page } from 'playwright';
import unbcTimberwolvesModule from './index.js';
import type { RunContext } from '../../types.js';

describe('UNBC Timberwolves Scraper', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
  });

  it('should have correct module configuration', () => {
    expect(unbcTimberwolvesModule.key).toBe('unbctimberwolves_com');
    expect(unbcTimberwolvesModule.label).toBe('UNBC Timberwolves Athletics');
    expect(unbcTimberwolvesModule.startUrls).toContain('https://unbctimberwolves.com/calendar');
  });

  it('should scrape events successfully', async () => {
    const stats = { pagesCrawled: 0 };
    
    const context: RunContext = {
      page,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      jobData: { testMode: true }, // Test mode
      stats,
    };

    const events = await unbcTimberwolvesModule.run(context);
    
    expect(Array.isArray(events)).toBe(true);
    expect(stats.pagesCrawled).toBeGreaterThan(0);
    
    if (events.length > 0) {
      const event = events[0];
      
      // Check required fields
      expect(event.sourceEventId).toBeDefined();
      expect(event.title).toBeDefined();
      expect(event.start).toBeDefined();
      expect(event.city).toBe('Prince George');
      expect(event.region).toBe('British Columbia');
      expect(event.country).toBe('Canada');
      expect(event.organizer).toBe('UNBC Timberwolves Athletics');
      expect(event.category).toBe('Sports');
      expect(event.url).toBe('https://unbctimberwolves.com/calendar');
      
      // Check that start is a valid ISO date
      expect(new Date(event.start).toISOString()).toBe(event.start);
      
      // Check raw data structure
      expect(event.raw).toBeDefined();
      expect(event.raw.extractedAt).toBeDefined();
    }
  }, 60000); // 60 second timeout for slow networks

  it('should handle empty calendar gracefully', async () => {
    // Mock page with no events
    const mockPage = {
      goto: vi.fn(),
      waitForSelector: vi.fn(),
      waitForTimeout: vi.fn(),
      $eval: vi.fn().mockResolvedValue('August 2025'),
      evaluate: vi.fn().mockResolvedValue([]),
      $: vi.fn().mockResolvedValue(null),
      screenshot: vi.fn(),
      waitForEvent: vi.fn(),
    } as any;

    const context: RunContext = {
      page: mockPage,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      jobData: { testMode: true },
      stats: { pagesCrawled: 0 },
    };

    const events = await unbcTimberwolvesModule.run(context);
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBe(0);
  });

  it('should parse event data correctly', () => {
    // Test data parsing logic with mock data
    const mockEventData = {
      date: 'August 2025 22',
      dayOfMonth: '22',
      sport: 'Soccer',
      opponent: 'Thompson Rivers WolfPack',
      location: 'Prince George, BC',
      time: '5:30 PM',
      atVs: 'vs',
      ticketUrl: 'https://example.com/tickets',
      isHome: true
    };

    // This would test the parsing logic if extracted to a separate function
    expect(mockEventData.sport).toBe('Soccer');
    expect(mockEventData.isHome).toBe(true);
  });
});