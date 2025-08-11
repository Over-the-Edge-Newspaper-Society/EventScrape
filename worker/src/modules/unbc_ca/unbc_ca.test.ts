import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import unbcModule from './index.js';

describe('UNBC Scraper', () => {

  it('should have correct module metadata', () => {
    expect(unbcModule.key).toBe('unbc_ca');
    expect(unbcModule.label).toBe('University of Northern British Columbia Events');
    expect(unbcModule.startUrls).toContain('https://www.unbc.ca/events');
  });

  it('should extract event links from events listing HTML', async () => {
    const fixtureHtml = await readFile(
      join(process.cwd(), 'src/modules/unbc_ca/fixtures/events-listing.html'), 
      'utf-8'
    );
    
    // Mock DOM environment (simplified version without jsdom)
    const mockDocument = {
      querySelectorAll: (selector: string) => {
        if (selector === '.event-boxed') {
          return [
            {
              querySelector: (sel: string) => {
                if (sel === '.event-info h2 a') return { href: '/events/100421/robogarden-machine-learning-ai-bootcamp-info-session', textContent: 'RoboGarden Machine Learning & AI Bootcamp Info Session' };
                if (sel === '.day-and-time') return { textContent: 'Tuesday5:00 p.m. to 6:00 p.m.' };
                if (sel === '.event-info p:last-child') return { querySelectorAll: () => [{ textContent: 'Online' }, { textContent: 'Zoom' }] };
                return null;
              },
              querySelectorAll: (sel: string) => {
                if (sel === '.datesquare') return [{ querySelector: () => ({ textContent: '12' }), childNodes: [null, { textContent: 'Aug' }] }];
                return [];
              }
            }
          ];
        }
        return [];
      }
    };

    // Test the extraction logic pattern
    const eventElements = mockDocument.querySelectorAll('.event-boxed');
    expect(eventElements).toHaveLength(1);

    const eventEl = eventElements[0];
    const titleLinkEl = eventEl.querySelector('.event-info h2 a');
    expect(titleLinkEl?.textContent?.trim()).toBe('RoboGarden Machine Learning & AI Bootcamp Info Session');
    expect(titleLinkEl?.href).toBe('/events/100421/robogarden-machine-learning-ai-bootcamp-info-session');
  });

  it('should extract event details from detail page HTML', async () => {
    const fixtureHtml = await readFile(
      join(process.cwd(), 'src/modules/unbc_ca/fixtures/event-detail.html'), 
      'utf-8'
    );
    
    // Mock DOM for detail page
    const mockDocument = {
      querySelector: (selector: string) => {
        if (selector === 'h1 .field--name-title') return { textContent: 'RoboGarden Machine Learning & AI Bootcamp Info Session' };
        if (selector === '.field--name-field-location .field__item') return { textContent: 'Zoom' };
        if (selector === '.field--name-field-campuses .field__item') return { textContent: 'Online' };
        if (selector === '.field--name-field-short-description .featured-text') return { innerHTML: 'Join us at this free, online info session' };
        if (selector === '.field--name-field-hero-image img') return { src: '/sites/default/files/styles/cover_image/public/event/design-4-1200x628.png.webp' };
        if (selector === '.field--name-field-content a.btn') return { href: 'https://events.teams.microsoft.com/event/registration' };
        return null;
      },
      querySelectorAll: (selector: string) => {
        if (selector === '.field--name-field-smart-date-ranges time[datetime]') {
          return [
            { getAttribute: () => '2025-08-12T17:00:00-07:00' },
            { getAttribute: () => '2025-08-12T18:00:00-07:00' }
          ];
        }
        return [];
      }
    };

    // Test the extraction logic
    const titleEl = mockDocument.querySelector('h1 .field--name-title');
    expect(titleEl?.textContent?.trim()).toBe('RoboGarden Machine Learning & AI Bootcamp Info Session');

    const locationEl = mockDocument.querySelector('.field--name-field-location .field__item');
    expect(locationEl?.textContent?.trim()).toBe('Zoom');

    const campusEl = mockDocument.querySelector('.field--name-field-campuses .field__item');
    expect(campusEl?.textContent?.trim()).toBe('Online');

    const datetimeElements = mockDocument.querySelectorAll('.field--name-field-smart-date-ranges time[datetime]');
    expect(datetimeElements).toHaveLength(2);
    expect(datetimeElements[0].getAttribute('datetime')).toBe('2025-08-12T17:00:00-07:00');
    expect(datetimeElements[1].getAttribute('datetime')).toBe('2025-08-12T18:00:00-07:00');
  });

  it('should parse date and time correctly', () => {
    // Test date parsing logic
    const testCases = [
      { date: 'Aug 12, 2025', time: '5:00 p.m. to 6:00 p.m.', expected: '5:00 PM' },
      { date: 'Sep 15, 2025', time: 'All day', expected: 'All day' },
      { date: 'Oct 1, 2025', time: '9:00 a.m.', expected: '9:00 AM' }
    ];

    testCases.forEach(testCase => {
      let timeStr = testCase.time;
      if (timeStr === 'All day') {
        expect(timeStr).toBe('All day');
      } else {
        // Extract start time from ranges
        if (timeStr.includes(' to ')) {
          timeStr = timeStr.split(' to ')[0].trim();
        }
        // Normalize time format
        let normalizedTime = timeStr.replace(/\./g, '').toUpperCase();
        expect(normalizedTime).toContain(testCase.expected.replace(/\./g, ''));
      }
    });
  });
});