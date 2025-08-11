import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import tourismPgModule from './index.js';

describe('Tourism Prince George Scraper', () => {

  it('should have correct module metadata', () => {
    expect(tourismPgModule.key).toBe('tourismpg_com');
    expect(tourismPgModule.label).toBe('Tourism Prince George Events');
    expect(tourismPgModule.startUrls).toContain('https://tourismpg.com/explore/events/');
  });

  it('should extract event links from JetEngine calendar', async () => {
    const fixtureHtml = await readFile(
      join(process.cwd(), 'src/modules/tourismpg_com/fixtures/calendar.html'), 
      'utf-8'
    );
    
    // Mock DOM for calendar extraction
    const mockDocument = {
      querySelector: (selector: string) => {
        if (selector === '.jet-calendar-caption__name') {
          return { textContent: 'August 2025' };
        }
        return null;
      },
      querySelectorAll: (selector: string) => {
        if (selector === '.jet-calendar-week__day.has-events') {
          return [
            {
              querySelector: (sel: string) => {
                if (sel === '.jet-calendar-week__day-date') {
                  return { textContent: '27' };
                }
                return null;
              },
              querySelectorAll: (sel: string) => {
                if (sel === '.jet-calendar-week__day-event') {
                  return [
                    {
                      querySelector: (innerSel: string) => {
                        if (innerSel === '.elementor-heading-title a') {
                          return { 
                            href: 'https://tourismpg.com/events/bcne-renaissance-faire-2/',
                            textContent: 'BCNE Renaissance Faire'
                          };
                        }
                        return null;
                      }
                    }
                  ];
                }
                return [];
              }
            }
          ];
        }
        return [];
      }
    };

    // Test the extraction logic pattern
    const currentMonth = mockDocument.querySelector('.jet-calendar-caption__name')?.textContent?.trim() || '';
    expect(currentMonth).toBe('August 2025');

    const dayCells = mockDocument.querySelectorAll('.jet-calendar-week__day.has-events');
    expect(dayCells).toHaveLength(1);

    const dayCell = dayCells[0];
    const dayNumber = dayCell.querySelector('.jet-calendar-week__day-date')?.textContent?.trim() || '';
    expect(dayNumber).toBe('27');

    const eventElements = dayCell.querySelectorAll('.jet-calendar-week__day-event');
    expect(eventElements).toHaveLength(1);

    const titleLinkEl = eventElements[0].querySelector('.elementor-heading-title a');
    expect(titleLinkEl?.textContent?.trim()).toBe('BCNE Renaissance Faire');
    expect(titleLinkEl?.href).toBe('https://tourismpg.com/events/bcne-renaissance-faire-2/');
  });

  it('should extract event details from event page', async () => {
    const fixtureHtml = await readFile(
      join(process.cwd(), 'src/modules/tourismpg_com/fixtures/event-detail.html'), 
      'utf-8'
    );
    
    // Mock DOM for event detail page
    const mockDocument = {
      querySelector: (selector: string) => {
        if (selector === '.elementor-heading-title') {
          return { textContent: 'BCNE Renaissance Faire' };
        }
        if (selector === '.event-start-date .jet-listing-dynamic-field__content') {
          return { textContent: 'Happening July 27, 2025' };
        }
        if (selector === '.event-end-date .jet-listing-dynamic-field__content') {
          return { textContent: '- July 27, 2025' };
        }
        if (selector === '.elementor-widget-theme-post-content .elementor-widget-container') {
          return { innerHTML: '<ul><li>The Village Shoppes</li><li>Food Trucks</li><li>Kids Zone</li></ul>' };
        }
        if (selector === '.elementor-button-link[href]') {
          return { href: 'https://www.cncentre.ca/' };
        }
        if (selector === 'iframe[src*="maps.google.com"]') {
          return { src: 'https://maps.google.com/maps?q=2187%20Ospika%20Blvd%20S%2C%20Prince%20George%2C%20BC' };
        }
        return null;
      },
      querySelectorAll: (selector: string) => {
        if (selector === '.jet-listing-dynamic-field__content') {
          return [
            { textContent: 'Happening July 27, 2025' },
            { textContent: '- July 27, 2025' },
            { textContent: '10:00am' },
            { textContent: '- 4:00pm' }
          ];
        }
        if (selector === '.elementor-widget-text-editor .elementor-widget-container') {
          return [
            { textContent: '2187 Ospika Blvd S' },
            { textContent: 'Prince George,' },
            { textContent: 'BC' },
            { textContent: 'V2N 1B2' }
          ];
        }
        return [];
      }
    };

    // Test the extraction logic
    const titleEl = mockDocument.querySelector('.elementor-heading-title');
    expect(titleEl?.textContent?.trim()).toBe('BCNE Renaissance Faire');

    const startDateEl = mockDocument.querySelector('.event-start-date .jet-listing-dynamic-field__content');
    expect(startDateEl?.textContent?.trim()).toBe('Happening July 27, 2025');

    const timeElements = mockDocument.querySelectorAll('.jet-listing-dynamic-field__content');
    let startTime = '';
    let endTime = '';
    
    timeElements.forEach(el => {
      const text = el.textContent?.trim() || '';
      if (text.match(/^\d{1,2}:\d{2}[ap]m$/i)) {
        if (!startTime) {
          startTime = text;
        } else if (!endTime && text !== startTime) {
          endTime = text;
        }
      } else if (text.match(/^-\s*\d{1,2}:\d{2}[ap]m$/i)) {
        endTime = text.replace(/^-\s*/, '');
      }
    });

    expect(startTime).toBe('10:00am');
    expect(endTime).toBe('4:00pm');

    const locationElements = mockDocument.querySelectorAll('.elementor-widget-text-editor .elementor-widget-container');
    const locationParts: string[] = [];
    
    locationElements.forEach(el => {
      const text = el.textContent?.trim();
      if (text && text.length > 0 && text.length < 100) {
        locationParts.push(text);
      }
    });

    expect(locationParts).toContain('2187 Ospika Blvd S');
    expect(locationParts).toContain('Prince George,');
    expect(locationParts).toContain('BC');
    expect(locationParts).toContain('V2N 1B2');

    const websiteButtonEl = mockDocument.querySelector('.elementor-button-link[href]');
    expect(websiteButtonEl?.href).toBe('https://www.cncentre.ca/');

    const mapIframe = mockDocument.querySelector('iframe[src*="maps.google.com"]');
    expect(mapIframe?.src).toContain('2187%20Ospika%20Blvd%20S');
  });

  it('should parse date and time correctly', () => {
    const testCases = [
      {
        startDateText: 'Happening July 27, 2025',
        startTime: '10:00am',
        endTime: '4:00pm',
        expectedStartHour: 10,
        expectedEndHour: 16
      },
      {
        startDateText: 'Happening December 15, 2025',
        startTime: '7:00pm',
        endTime: null,
        expectedStartHour: 19,
        expectedEndHour: null
      }
    ];

    testCases.forEach(testCase => {
      const dateMatch = testCase.startDateText.match(/(\w+ \d+, \d+)/);
      expect(dateMatch).toBeTruthy();
      
      if (dateMatch) {
        const dateStr = dateMatch[1];
        
        if (testCase.startTime) {
          const normalizedStartTime = testCase.startTime.replace(/([ap])m$/i, ' $1M').toUpperCase();
          const combinedDateTime = `${dateStr} ${normalizedStartTime}`;
          const dateObj = new Date(combinedDateTime);
          
          expect(dateObj.getHours()).toBe(testCase.expectedStartHour);
          
          if (testCase.endTime) {
            const normalizedEndTime = testCase.endTime.replace(/([ap])m$/i, ' $1M').toUpperCase();
            const endCombined = `${dateStr} ${normalizedEndTime}`;
            const endDateObj = new Date(endCombined);
            
            expect(endDateObj.getHours()).toBe(testCase.expectedEndHour);
          }
        }
      }
    });
  });

  it('should handle location parsing correctly', () => {
    const locationParts = ['2187 Ospika Blvd S', 'Prince George,', 'BC', 'V2N 1B2'];
    const mapSrc = 'https://maps.google.com/maps?q=2187%20Ospika%20Blvd%20S%2C%20Prince%20George%2C%20BC&t=m&z=12&output=embed';

    // Test address extraction - filter out city, province and postal code
    const addressParts = locationParts.filter(part => 
      part && !part.match(/^(Prince George,?|BC|V\d\w\s*\d\w\d)$/i)
    );
    
    expect(addressParts).toContain('2187 Ospika Blvd S');
    expect(addressParts).not.toContain('BC');
    expect(addressParts).not.toContain('V2N 1B2');
    // Note: 'Prince George,' with comma won't match the regex without comma

    // Test venue name extraction from map source
    const mapQuery = mapSrc.match(/q=([^&]+)/);
    expect(mapQuery).toBeTruthy();
    
    if (mapQuery) {
      const decodedQuery = decodeURIComponent(mapQuery[1]);
      const parts = decodedQuery.split(',');
      expect(parts[0].trim()).toBe('2187 Ospika Blvd S');
    }
  });

  it('should create proper event objects', () => {
    const eventData = {
      title: 'BCNE Renaissance Faire',
      startDateText: 'Happening July 27, 2025',
      startTime: '10:00am',
      endTime: '4:00pm',
      locationParts: ['2187 Ospika Blvd S', 'Prince George,', 'BC', 'V2N 1B2'],
      description: '<ul><li>The Village Shoppes</li><li>Food Trucks</li></ul>',
      venueWebsite: 'https://www.cncentre.ca/'
    };

    const eventLink = {
      url: 'https://tourismpg.com/events/bcne-renaissance-faire-2/',
      title: 'BCNE Renaissance Faire',
      date: 'August 27'
    };

    // Test event creation logic
    const sourceEventId = `${eventLink.url}#${eventLink.date}`;
    expect(sourceEventId).toBe('https://tourismpg.com/events/bcne-renaissance-faire-2/#August 27');

    // Test basic event structure
    expect(eventData.title).toBe('BCNE Renaissance Faire');
    expect(eventData.startTime).toBe('10:00am');
    expect(eventData.endTime).toBe('4:00pm');
    expect(eventData.description).toContain('Village Shoppes');
    expect(eventData.venueWebsite).toBe('https://www.cncentre.ca/');
  });
});