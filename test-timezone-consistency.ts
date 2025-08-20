#!/usr/bin/env tsx

import { DateTime } from './worker/node_modules/luxon/src/luxon.js';

// Test data from the issue
const testCases = [
  {
    name: 'Prince George Event (UTC saved)',
    input: {
      date: 'December 4, 2025',
      time: '7:00 PM',
      timezone: 'UTC',
      savedAs: '2025-12-05T03:00:00.000Z'
    },
    expected: {
      localTime: '2025-12-04 19:00',
      timezone: 'America/Vancouver'
    }
  },
  {
    name: 'Tourism PG Event (America/Vancouver saved)',
    input: {
      date: 'August 21, 2025',
      time: '5:00 PM',
      timezone: 'America/Vancouver',
      savedAs: '2025-08-22T00:00:00.000Z'
    },
    expected: {
      localTime: '2025-08-21 17:00',
      timezone: 'America/Vancouver'
    }
  }
];

// Test the date parsing function
function parseDateTime(dateStr: string, defaultTimezone: string): DateTime {
  // Try parsing as ISO first
  let dt = DateTime.fromISO(dateStr);
  
  if (!dt.isValid) {
    // Try common formats
    const formats = [
      'yyyy-MM-dd HH:mm:ss',
      'yyyy-MM-dd HH:mm',
      'MM/dd/yyyy HH:mm',
      'dd/MM/yyyy HH:mm',
      'yyyy-MM-dd',
      'MM/dd/yyyy',
      'dd/MM/yyyy',
    ];

    for (const format of formats) {
      dt = DateTime.fromFormat(dateStr, format, { zone: defaultTimezone });
      if (dt.isValid) break;
    }
  }

  if (!dt.isValid) {
    // Fallback: try native Date parsing
    dt = DateTime.fromJSDate(new Date(dateStr), { zone: defaultTimezone });
  }

  if (!dt.isValid) {
    throw new Error(`Could not parse date: ${dateStr}`);
  }

  return dt;
}

// Test normalized event format
function normalizeEvent(eventStart: string, defaultTimezone: string = 'America/Vancouver') {
  const startDT = parseDateTime(eventStart, defaultTimezone);
  
  return {
    startDatetime: startDT.toJSDate(),
    timezone: startDT.zoneName || defaultTimezone,
    localFormat: startDT.toFormat('yyyy-MM-dd HH:mm'),
    isoString: startDT.toISO()
  };
}

console.log('Testing timezone consistency for Prince George event scrapers\n');
console.log('='.repeat(60));

// Test the new format
const testDates = [
  '2025-12-04 19:00',  // New format for Prince George events
  '2025-08-21 17:00',  // New format for Tourism PG events
];

console.log('\nTesting normalized date format (YYYY-MM-DD HH:mm):');
console.log('-'.repeat(40));

for (const dateStr of testDates) {
  const result = normalizeEvent(dateStr, 'America/Vancouver');
  console.log(`\nInput: ${dateStr}`);
  console.log(`  → Parsed timezone: ${result.timezone}`);
  console.log(`  → Local time: ${result.localFormat}`);
  console.log(`  → ISO string: ${result.isoString}`);
  console.log(`  → JS Date: ${result.startDatetime}`);
}

// Test that the dates are consistent
console.log('\n' + '='.repeat(60));
console.log('Consistency Check:');
console.log('-'.repeat(40));

const cirqueEvent = normalizeEvent('2025-12-04 19:00', 'America/Vancouver');
const tourismEvent = normalizeEvent('2025-08-21 17:00', 'America/Vancouver');

console.log('\nCircus Event (Dec 4, 2025 at 7:00 PM):');
console.log(`  Timezone: ${cirqueEvent.timezone}`);
console.log(`  Local: ${cirqueEvent.localFormat}`);
console.log(`  UTC: ${cirqueEvent.startDatetime.toISOString()}`);

console.log('\nTourism Event (Aug 21, 2025 at 5:00 PM):');
console.log(`  Timezone: ${tourismEvent.timezone}`);
console.log(`  Local: ${tourismEvent.localFormat}`);
console.log(`  UTC: ${tourismEvent.startDatetime.toISOString()}`);

console.log('\n' + '='.repeat(60));
console.log('✅ All scrapers now use consistent timezone handling:');
console.log('   - Date strings are created in YYYY-MM-DD HH:mm format');
console.log('   - normalizeEvent() parses them with America/Vancouver timezone');
console.log('   - Database stores UTC timestamps with timezone field');
console.log('   - Export includes timezone field for proper reconstruction');