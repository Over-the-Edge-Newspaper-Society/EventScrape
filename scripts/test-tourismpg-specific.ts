#!/usr/bin/env tsx

import { chromium } from 'playwright';

const testUrls = [
  'https://tourismpg.com/events/the-odd-couple-3/',
  'https://tourismpg.com/events/carefree-launch-event/',
  'https://tourismpg.com/events/coldsnap-presents-jeremy-dutcher/'
];

async function testSpecificEvents() {
  console.log('🔍 Testing specific Tourism PG events...\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 720 });

    for (const url of testUrls) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`Testing: ${url}`);
      console.log('='.repeat(80));

      await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });

      const eventData = await page.evaluate(() => {
        // Extract all text that might contain recurrence info
        const bodyText = document.body.innerText;

        // Look for recurrence patterns
        const recurringPatterns = [
          /every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/gi,
          /weekly/gi,
          /daily/gi,
          /recurring/gi,
          /repeat/gi
        ];

        const recurrenceMatches: string[] = [];
        recurringPatterns.forEach(pattern => {
          const matches = bodyText.match(pattern);
          if (matches) {
            recurrenceMatches.push(...matches);
          }
        });

        // Extract title
        const titleEl = document.querySelector('.elementor-heading-title, h1');
        const title = titleEl?.textContent?.trim() || 'N/A';

        // Extract dates
        const startDateEl = document.querySelector('.event-start-date .jet-listing-dynamic-field__content');
        const startDateText = startDateEl?.textContent?.trim() || '';

        const endDateEl = document.querySelector('.event-end-date .jet-listing-dynamic-field__content');
        const endDateText = endDateEl?.textContent?.trim() || '';

        // Extract times
        const timeElements = document.querySelectorAll('.jet-listing-dynamic-field__content');
        const times: string[] = [];
        timeElements.forEach(el => {
          const text = el.textContent?.trim() || '';
          if (text.match(/\d{1,2}:\d{2}[ap]m/i)) {
            times.push(text);
          }
        });

        // Look for any date-related elements
        const dateFields = Array.from(document.querySelectorAll('[class*="date"], [class*="time"]'))
          .map(el => el.textContent?.trim())
          .filter(text => text && text.length > 0 && text.length < 200);

        return {
          title,
          startDateText,
          endDateText,
          times,
          dateFields: [...new Set(dateFields)],
          recurrenceMatches: [...new Set(recurrenceMatches)],
          hasRecurrence: recurrenceMatches.length > 0
        };
      });

      console.log('\n📊 Extracted Data:');
      console.log(`   Title: ${eventData.title}`);
      console.log(`   Start Date: ${eventData.startDateText}`);
      console.log(`   End Date: ${eventData.endDateText}`);
      console.log(`   Times: ${eventData.times.join(', ') || 'None found'}`);
      console.log(`   Recurrence Found: ${eventData.hasRecurrence ? 'YES' : 'NO'}`);

      if (eventData.hasRecurrence) {
        console.log(`   Recurrence Patterns: ${eventData.recurrenceMatches.join(', ')}`);
      }

      console.log('\n   Date-related fields:');
      eventData.dateFields.slice(0, 10).forEach(field => {
        console.log(`     - ${field}`);
      });
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log('✅ Testing completed');

  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

testSpecificEvents()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });
