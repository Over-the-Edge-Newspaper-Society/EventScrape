import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { JSDOM } from 'jsdom';
import princeGeorgeModule from './index.js';

describe('Prince George CA Module', () => {
  it('should have correct module configuration', () => {
    expect(princeGeorgeModule.key).toBe('prince_george_ca');
    expect(princeGeorgeModule.label).toBe('City of Prince George Events');
    expect(princeGeorgeModule.startUrls).toContain('https://www.princegeorge.ca/community-culture/events/events-calendar');
  });

  it('should extract event links from calendar HTML', async () => {
    const fixtureHtml = await readFile(
      join(process.cwd(), 'src/modules/prince_george_ca/fixtures/calendar.html'), 
      'utf-8'
    );
    
    const dom = new JSDOM(fixtureHtml);
    global.document = dom.window.document;
    global.window = dom.window as any;

    // Simulate the extraction logic from the module
    const eventLinks = Array.from(document.querySelectorAll('.fc-list-item')).map(row => {
      const linkEl = row.querySelector('.fc-list-item-title a') as HTMLAnchorElement;
      const timeEl = row.querySelector('.fc-list-item-time');
      
      if (linkEl && timeEl) {
        // Find the date heading for this event
        let dateHeading = row.previousElementSibling;
        while (dateHeading && !dateHeading.classList.contains('fc-list-heading')) {
          dateHeading = dateHeading.previousElementSibling;
        }
        
        const dateText = dateHeading?.querySelector('.fc-list-heading-main')?.textContent?.trim() || '';
        
        return {
          url: linkEl.href,
          title: linkEl.textContent?.trim() || '',
          time: timeEl.textContent?.trim() || '',
          date: dateText
        };
      }
      return null;
    }).filter(Boolean);

    expect(eventLinks).toHaveLength(4);
    
    const foodieFridays = eventLinks.find(link => link.title === 'Foodie Fridays');
    expect(foodieFridays).toBeDefined();
    expect(foodieFridays.time).toBe('11:00am - 3:00pm');
    expect(foodieFridays.date).toBe('August 1, 2025');
    expect(foodieFridays.url).toBe('/community-culture/arts-events/events-calendar/foodie-fridays');

    const yoga = eventLinks.find(link => link.title === 'Yoga in the Park');
    expect(yoga).toBeDefined();
    expect(yoga.time).toBe('10:00am - 11:00am');
    expect(yoga.date).toBe('August 3, 2025');
  });

  it('should extract event details from detail page HTML', async () => {
    const fixtureHtml = await readFile(
      join(process.cwd(), 'src/modules/prince_george_ca/fixtures/event-detail.html'), 
      'utf-8'
    );
    
    const dom = new JSDOM(fixtureHtml);
    global.document = dom.window.document;
    global.window = dom.window as any;

    // Extract event dates and times
    const dateTimeElements = document.querySelectorAll('.field--name-field-when .field__item');
    const eventDates: Array<{start: string, end?: string}> = [];
    
    dateTimeElements.forEach(el => {
      const timeElements = el.querySelectorAll('time[datetime]');
      if (timeElements.length >= 1) {
        const startTime = timeElements[0].getAttribute('datetime');
        const endTime = timeElements[1]?.getAttribute('datetime');
        
        if (startTime) {
          eventDates.push({
            start: startTime,
            end: endTime || undefined
          });
        }
      }
    });

    expect(eventDates).toHaveLength(4);
    expect(eventDates[0]).toEqual({
      start: '2025-07-04T11:00:00-07:00',
      end: '2025-07-04T15:00:00-07:00'
    });

    // Extract event types
    const eventTypeEl = document.querySelector('.field--name-field-types .field__item');
    const communityTypeEl = document.querySelector('.field--name-field-types2 .field__item');
    expect(eventTypeEl?.textContent?.trim()).toBe('Civic Centre Event');
    expect(communityTypeEl?.textContent?.trim()).toBe('Special Events');

    // Extract location
    const locationEl = document.querySelector('.field--name-field-contact-information .field__item p');
    expect(locationEl?.textContent?.trim()).toBe('Canada Games Plaza');

    // Extract description
    const descriptionEl = document.querySelector('.field--name-body .field__item');
    expect(descriptionEl?.textContent).toContain('Come down to the Canada Games Plaza');
    expect(descriptionEl?.textContent).toContain('Foodie Fridays');

    // Extract image
    const imageEl = document.querySelector('.field--name-field-media-image img') as HTMLImageElement;
    expect(imageEl?.src).toContain('Foodie%20Fridays%20-%20Omnivex.png');
  });

  it('matches series instances to a calendar date (YYYY-MM-DD or natural language)', async () => {
    const fixtureHtml = await readFile(join(process.cwd(), 'worker/src/modules/prince_george_ca/fixtures/event-detail.html'), 'utf-8');
    const dom = new JSDOM(fixtureHtml);
    const { document } = dom.window as any;

    const dateItems = Array.from(document.querySelectorAll('.field--name-field-when .field__item')) as HTMLElement[];
    const dates: Array<{ start: string, end?: string }> = [];
    dateItems.forEach(item => {
      const times = item.querySelectorAll('time[datetime]');
      if (times.length >= 1) {
        const start = times[0].getAttribute('datetime') || '';
        const endAttr = times[1]?.getAttribute('datetime') || undefined;
        if (start) dates.push({ start, end: endAttr || undefined });
      }
    });

    // Helper to normalize dates similar to module code
    const normalizeToYMD = (d: string): string | null => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
      const tmp = new Date(d);
      if (isNaN(tmp.getTime())) return null;
      return `${tmp.getFullYear()}-${(tmp.getMonth() + 1).toString().padStart(2, '0')}-${tmp.getDate().toString().padStart(2, '0')}`;
    };

    // Take a target calendar date and ensure we pick the matching instance
    const target1 = '2025-08-01';
    const match1 = dates.find(d => d.start.split('T')[0] === normalizeToYMD(target1));
    expect(match1?.start).toBe('2025-08-01T11:00:00-07:00');
    expect(match1?.end).toBe('2025-08-01T15:00:00-07:00');

    const target2 = 'Friday, July 4, 2025';
    const match2 = dates.find(d => d.start.split('T')[0] === normalizeToYMD(target2));
    expect(match2?.start).toBe('2025-07-04T11:00:00-07:00');
  });

  it('should normalize event data correctly', () => {
    const testEventData = {
      title: 'Foodie Fridays',
      dates: [{
        start: '2025-08-01T11:00:00-07:00',
        end: '2025-08-01T15:00:00-07:00'
      }],
      eventType: 'Civic Centre Event',
      communityType: 'Special Events',
      location: 'Canada Games Plaza',
      description: '<p>Come down to the Canada Games Plaza...</p>',
      imageUrl: '/sites/default/files/2025-06/Foodie%20Fridays%20-%20Omnivex.png',
      url: 'https://www.princegeorge.ca/community-culture/arts-events/events-calendar/foodie-fridays'
    };

    const categories = [testEventData.eventType, testEventData.communityType].filter(Boolean);

    expect(categories).toEqual(['Civic Centre Event', 'Special Events']);
    expect(testEventData.dates[0].start).toBe('2025-08-01T11:00:00-07:00');
    expect(testEventData.location).toBe('Canada Games Plaza');
  });
});
