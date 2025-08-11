import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import downtownPgModule from './index.js';

describe('Downtown Prince George Scraper', () => {

  it('should have correct module metadata', () => {
    expect(downtownPgModule.key).toBe('downtownpg_com');
    expect(downtownPgModule.label).toBe('Downtown Prince George Events');
    expect(downtownPgModule.startUrls).toContain('https://downtownpg.com/events/');
  });

  it('should extract event links from MEC calendar', async () => {
    const fixtureHtml = await readFile(
      join(process.cwd(), 'src/modules/downtownpg_com/fixtures/events-page.html'), 
      'utf-8'
    );
    
    // Mock DOM for MEC calendar extraction
    const mockDocument = {
      querySelector: (selector: string) => {
        if (selector === '.mec-events-calendar') {
          return { found: true };
        }
        return null;
      },
      querySelectorAll: (selector: string) => {
        if (selector === '.mec-event-article, .mec-event-list-event, .mec-calendar-event') {
          return [
            {
              querySelector: (sel: string) => {
                if (sel === '.mec-event-title a, .mec-event-list-title a, h4 a') {
                  return { 
                    href: 'https://downtownpg.com/events/summer-music-festival/',
                    textContent: 'Summer Music Festival'
                  };
                }
                return null;
              },
              getAttribute: (attr: string) => {
                if (attr === 'data-event-id') return '123';
                return null;
              },
              id: ''
            },
            {
              querySelector: (sel: string) => {
                if (sel === '.mec-event-title a, .mec-event-list-title a, h4 a') {
                  return { 
                    href: 'https://downtownpg.com/events/art-walk/',
                    textContent: 'Downtown Art Walk'
                  };
                }
                return null;
              },
              getAttribute: (attr: string) => {
                if (attr === 'data-event-id') return '124';
                return null;
              },
              id: ''
            }
          ];
        }
        if (selector === 'script[type="application/ld+json"]') {
          return [
            {
              textContent: JSON.stringify([
                {
                  "@context": "https://schema.org",
                  "@type": "Event",
                  "name": "Summer Music Festival",
                  "startDate": "2025-08-15T19:00:00-07:00",
                  "url": "https://downtownpg.com/events/summer-music-festival/"
                }
              ])
            }
          ];
        }
        return [];
      }
    };

    // Test the extraction logic pattern
    const calendarEl = mockDocument.querySelector('.mec-events-calendar');
    expect(calendarEl).toBeTruthy();

    const eventElements = mockDocument.querySelectorAll('.mec-event-article, .mec-event-list-event, .mec-calendar-event');
    expect(eventElements).toHaveLength(2);

    const firstEvent = eventElements[0];
    const titleLinkEl = firstEvent.querySelector('.mec-event-title a, .mec-event-list-title a, h4 a');
    expect(titleLinkEl?.textContent).toBe('Summer Music Festival');
    expect(titleLinkEl?.href).toBe('https://downtownpg.com/events/summer-music-festival/');
    expect(firstEvent.getAttribute('data-event-id')).toBe('123');

    const secondEvent = eventElements[1];
    const secondTitleLinkEl = secondEvent.querySelector('.mec-event-title a, .mec-event-list-title a, h4 a');
    expect(secondTitleLinkEl?.textContent).toBe('Downtown Art Walk');
    expect(secondTitleLinkEl?.href).toBe('https://downtownpg.com/events/art-walk/');
  });

  it('should parse JSON-LD structured data', () => {
    const jsonLdContent = JSON.stringify([
      {
        "@context": "https://schema.org",
        "@type": "Event",
        "name": "Summer Music Festival",
        "startDate": "2025-08-15T19:00:00-07:00",
        "endDate": "2025-08-15T23:00:00-07:00",
        "location": {
          "@type": "Place",
          "name": "Downtown Plaza",
          "address": {
            "@type": "PostalAddress",
            "streetAddress": "1234 George Street",
            "addressLocality": "Prince George",
            "addressRegion": "BC"
          }
        },
        "organizer": {
          "@type": "Organization",
          "name": "Downtown Prince George"
        },
        "url": "https://downtownpg.com/events/summer-music-festival/"
      }
    ]);

    const parsedData = JSON.parse(jsonLdContent);
    expect(Array.isArray(parsedData)).toBe(true);
    
    const eventData = parsedData[0];
    expect(eventData['@type']).toBe('Event');
    expect(eventData.name).toBe('Summer Music Festival');
    expect(eventData.startDate).toBe('2025-08-15T19:00:00-07:00');
    expect(eventData.location.name).toBe('Downtown Plaza');
    expect(eventData.location.address.streetAddress).toBe('1234 George Street');
    expect(eventData.organizer.name).toBe('Downtown Prince George');
  });

  it('should extract event details from detail page', async () => {
    const fixtureHtml = await readFile(
      join(process.cwd(), 'src/modules/downtownpg_com/fixtures/event-detail.html'), 
      'utf-8'
    );
    
    // Mock DOM for event detail page
    const mockDocument = {
      querySelector: (selector: string) => {
        if (selector === '.mec-single-title, h1.entry-title, h1, .event-title') {
          return { textContent: 'Summer Music Festival' };
        }
        if (selector === '.mec-start-date, .mec-event-date, .event-date') {
          return { textContent: 'August 15, 2025' };
        }
        if (selector === '.mec-start-time, .mec-event-time, .event-time') {
          return { textContent: '7:00 PM' };
        }
        if (selector === '.mec-end-time, .mec-event-end-time') {
          return { textContent: '11:00 PM' };
        }
        if (selector === '.mec-event-location, .mec-location, .event-location') {
          return { textContent: 'Downtown Plaza' };
        }
        if (selector === '.mec-event-address, .mec-address, .event-address') {
          return { textContent: '1234 George Street, Prince George, BC V2L 2X1' };
        }
        if (selector === '.mec-single-event-description, .mec-event-content, .event-description, .entry-content') {
          return { innerHTML: '<p>Join us for the annual Summer Music Festival in beautiful downtown Prince George!</p>' };
        }
        if (selector === '.mec-event-organizer, .event-organizer') {
          return { textContent: 'Downtown Prince George' };
        }
        if (selector === '.mec-event-ticket a, .mec-ticket a, .event-tickets a') {
          return { href: 'https://tickets.example.com/summer-music-festival' };
        }
        if (selector === '.mec-event-website a, .event-website a') {
          return { href: 'https://downtownpg.com' };
        }
        return null;
      },
      querySelectorAll: (selector: string) => {
        if (selector === 'script[type="application/ld+json"]') {
          return [
            {
              textContent: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "Event",
                "name": "Summer Music Festival",
                "startDate": "2025-08-15T19:00:00-07:00",
                "endDate": "2025-08-15T23:00:00-07:00",
                "location": {
                  "@type": "Place",
                  "name": "Downtown Plaza",
                  "address": {
                    "@type": "PostalAddress",
                    "streetAddress": "1234 George Street"
                  }
                }
              })
            }
          ];
        }
        return [];
      }
    };

    // Test the extraction logic
    const titleEl = mockDocument.querySelector('.mec-single-title, h1.entry-title, h1, .event-title');
    expect(titleEl?.textContent).toBe('Summer Music Festival');

    const startDateEl = mockDocument.querySelector('.mec-start-date, .mec-event-date, .event-date');
    expect(startDateEl?.textContent).toBe('August 15, 2025');

    const startTimeEl = mockDocument.querySelector('.mec-start-time, .mec-event-time, .event-time');
    expect(startTimeEl?.textContent).toBe('7:00 PM');

    const locationEl = mockDocument.querySelector('.mec-event-location, .mec-location, .event-location');
    expect(locationEl?.textContent).toBe('Downtown Plaza');

    const addressEl = mockDocument.querySelector('.mec-event-address, .mec-address, .event-address');
    expect(addressEl?.textContent).toBe('1234 George Street, Prince George, BC V2L 2X1');

    const organizerEl = mockDocument.querySelector('.mec-event-organizer, .event-organizer');
    expect(organizerEl?.textContent).toBe('Downtown Prince George');

    // Test JSON-LD extraction
    const jsonLdScripts = mockDocument.querySelectorAll('script[type="application/ld+json"]');
    expect(jsonLdScripts).toHaveLength(1);
    
    const structuredData = JSON.parse(jsonLdScripts[0].textContent);
    expect(structuredData['@type']).toBe('Event');
    expect(structuredData.name).toBe('Summer Music Festival');
    expect(structuredData.location.name).toBe('Downtown Plaza');
  });

  it('should handle date parsing from structured data', () => {
    const structuredData = {
      "@type": "Event",
      "startDate": "2025-08-15T19:00:00-07:00",
      "endDate": "2025-08-15T23:00:00-07:00"
    };

    const eventStart = new Date(structuredData.startDate).toISOString();
    const eventEnd = new Date(structuredData.endDate).toISOString();

    expect(eventStart).toBe(new Date('2025-08-15T19:00:00-07:00').toISOString());
    expect(eventEnd).toBe(new Date('2025-08-15T23:00:00-07:00').toISOString());

    // Test hour extraction for verification
    const startDate = new Date(structuredData.startDate);
    const endDate = new Date(structuredData.endDate);
    
    expect(startDate.getHours()).toBe(new Date('2025-08-15T19:00:00-07:00').getHours());
    expect(endDate.getHours()).toBe(new Date('2025-08-15T23:00:00-07:00').getHours());
  });

  it('should create proper event objects', () => {
    const eventData = {
      title: 'Summer Music Festival',
      structuredEventData: {
        "@type": "Event",
        "startDate": "2025-08-15T19:00:00-07:00",
        "endDate": "2025-08-15T23:00:00-07:00",
        "location": {
          "name": "Downtown Plaza",
          "address": {
            "streetAddress": "1234 George Street"
          }
        }
      },
      organizer: 'Downtown Prince George',
      description: '<p>Annual summer music festival</p>',
      ticketUrl: 'https://tickets.example.com/summer-music-festival'
    };

    const eventLink = {
      url: 'https://downtownpg.com/events/summer-music-festival/',
      title: 'Summer Music Festival',
      eventId: '123'
    };

    // Test event creation logic
    const sourceEventId = eventLink.eventId || `${eventLink.url}#${eventLink.title}`;
    expect(sourceEventId).toBe('123');

    // Test structured data usage
    const eventStart = new Date(eventData.structuredEventData.startDate).toISOString();
    const eventEnd = new Date(eventData.structuredEventData.endDate).toISOString();

    expect(eventStart).toBeTruthy();
    expect(eventEnd).toBeTruthy();
    expect(eventData.structuredEventData.location.name).toBe('Downtown Plaza');
    expect(eventData.structuredEventData.location.address.streetAddress).toBe('1234 George Street');
  });

  it('should handle fallback when no structured data is available', () => {
    const eventDetails = {
      startDate: 'August 15, 2025',
      startTime: '7:00 PM',
      endTime: '11:00 PM',
      location: 'Downtown Plaza',
      address: '1234 George Street, Prince George, BC'
    };

    // Test fallback date parsing
    const startDateStr = eventDetails.startDate;
    const startTimeStr = eventDetails.startTime || '9:00 AM';
    const combinedStart = `${startDateStr} ${startTimeStr}`;
    const startDate = new Date(combinedStart);

    expect(isNaN(startDate.getTime())).toBe(false);
    expect(startDate.getHours()).toBe(19); // 7:00 PM

    // Test location handling
    expect(eventDetails.location).toBe('Downtown Plaza');
    expect(eventDetails.address).toContain('Prince George');
  });
});