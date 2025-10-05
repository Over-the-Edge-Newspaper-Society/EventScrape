/**
 * Test script to verify occurrence detection from local HTML files
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { detectOccurrenceType, detectRecurrencePattern } from './src/lib/occurrence-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testOccurrenceDetection() {
  console.log('🧪 Testing Occurrence Detection\n');

  // Test 1: Single-day event
  console.log('📅 Test 1: Single-Day Event');
  const singleDay = {
    startDatetime: new Date('2025-09-15T10:00:00-07:00'),
    endDatetime: new Date('2025-09-15T13:00:00-07:00'),
    timezone: 'America/Vancouver',
    raw: {}
  };
  const singleResult = detectOccurrenceType(singleDay);
  console.log(`  Type: ${singleResult.occurrenceType}`);
  console.log(`  Recurrence: ${singleResult.recurrenceType}`);
  console.log(`  All-day: ${singleResult.isAllDay}`);
  console.log(`  Virtual: ${singleResult.isVirtual}\n`);

  // Test 2: Multi-day event (spans more than 24 hours)
  console.log('📅 Test 2: Multi-Day Event');
  const multiDay = {
    startDatetime: new Date('2025-09-15T09:00:00-07:00'),
    endDatetime: new Date('2025-09-17T17:00:00-07:00'), // 2+ days
    timezone: 'America/Vancouver',
    raw: {}
  };
  const multiResult = detectOccurrenceType(multiDay);
  console.log(`  Type: ${multiResult.occurrenceType}`);
  console.log(`  Duration: ${(multiDay.endDatetime - multiDay.startDatetime) / (1000 * 60 * 60)} hours\n`);

  // Test 3: All-day event
  console.log('📅 Test 3: All-Day Event');
  const allDay = {
    startDatetime: new Date('2025-09-15T00:00:00-07:00'),
    endDatetime: new Date('2025-09-15T23:59:59-07:00'),
    timezone: 'America/Vancouver',
    raw: { isAllDay: true }
  };
  const allDayResult = detectOccurrenceType(allDay);
  console.log(`  Type: ${allDayResult.occurrenceType}`);
  console.log(`  All-day flag: ${allDayResult.isAllDay}\n`);

  // Test 4: Virtual event
  console.log('📅 Test 4: Virtual Event');
  const virtual = {
    startDatetime: new Date('2025-09-15T14:00:00-07:00'),
    endDatetime: new Date('2025-09-15T15:30:00-07:00'),
    timezone: 'America/Vancouver',
    raw: { virtualUrl: 'https://zoom.us/j/123456789' }
  };
  const virtualResult = detectOccurrenceType(virtual);
  console.log(`  Type: ${virtualResult.occurrenceType}`);
  console.log(`  Virtual: ${virtualResult.isVirtual}`);
  console.log(`  Virtual URL: ${virtual.raw.virtualUrl}\n`);

  // Test 5: Weekly recurring event (4 occurrences)
  console.log('📅 Test 5: Weekly Recurring Event');
  const weeklyRecurring = {
    startDatetime: new Date('2025-09-03T10:00:00-07:00'),
    endDatetime: new Date('2025-09-03T13:00:00-07:00'),
    timezone: 'America/Vancouver',
    raw: {
      seriesDates: [
        { start: '2025-09-03T10:00:00-07:00', end: '2025-09-03T13:00:00-07:00' },
        { start: '2025-09-10T10:00:00-07:00', end: '2025-09-10T13:00:00-07:00' },
        { start: '2025-09-17T10:00:00-07:00', end: '2025-09-17T13:00:00-07:00' },
        { start: '2025-09-24T10:00:00-07:00', end: '2025-09-24T13:00:00-07:00' }
      ]
    }
  };
  const weeklyResult = detectOccurrenceType(weeklyRecurring);
  console.log(`  Type: ${weeklyResult.occurrenceType}`);
  console.log(`  Recurrence: ${weeklyResult.recurrenceType}`);
  console.log(`  Occurrences: ${weeklyRecurring.raw.seriesDates.length}`);

  // Calculate intervals
  const intervals = [];
  for (let i = 1; i < weeklyRecurring.raw.seriesDates.length; i++) {
    const prev = new Date(weeklyRecurring.raw.seriesDates[i - 1].start);
    const curr = new Date(weeklyRecurring.raw.seriesDates[i].start);
    const diffDays = Math.round((curr - prev) / (1000 * 60 * 60 * 24));
    intervals.push(diffDays);
  }
  console.log(`  Intervals: ${intervals.join(', ')} days\n`);

  // Test 6: Daily recurring event
  console.log('📅 Test 6: Daily Recurring Event');
  const dailyRecurring = {
    startDatetime: new Date('2025-09-01T09:00:00-07:00'),
    endDatetime: new Date('2025-09-01T10:00:00-07:00'),
    timezone: 'America/Vancouver',
    raw: {
      seriesDates: [
        { start: '2025-09-01T09:00:00-07:00', end: '2025-09-01T10:00:00-07:00' },
        { start: '2025-09-02T09:00:00-07:00', end: '2025-09-02T10:00:00-07:00' },
        { start: '2025-09-03T09:00:00-07:00', end: '2025-09-03T10:00:00-07:00' },
        { start: '2025-09-04T09:00:00-07:00', end: '2025-09-04T10:00:00-07:00' },
        { start: '2025-09-05T09:00:00-07:00', end: '2025-09-05T10:00:00-07:00' }
      ]
    }
  };
  const dailyResult = detectOccurrenceType(dailyRecurring);
  console.log(`  Type: ${dailyResult.occurrenceType}`);
  console.log(`  Recurrence: ${dailyResult.recurrenceType}`);
  console.log(`  Occurrences: ${dailyRecurring.raw.seriesDates.length}\n`);

  // Test 7: Monthly recurring event
  console.log('📅 Test 7: Monthly Recurring Event');
  const monthlyRecurring = {
    startDatetime: new Date('2025-09-05T18:00:00-07:00'),
    endDatetime: new Date('2025-09-05T20:00:00-07:00'),
    timezone: 'America/Vancouver',
    raw: {
      seriesDates: [
        { start: '2025-09-05T18:00:00-07:00', end: '2025-09-05T20:00:00-07:00' },
        { start: '2025-10-05T18:00:00-07:00', end: '2025-10-05T20:00:00-07:00' },
        { start: '2025-11-05T18:00:00-07:00', end: '2025-11-05T20:00:00-07:00' }
      ]
    }
  };
  const monthlyResult = detectOccurrenceType(monthlyRecurring);
  console.log(`  Type: ${monthlyResult.occurrenceType}`);
  console.log(`  Recurrence: ${monthlyResult.recurrenceType}`);
  console.log(`  Occurrences: ${monthlyRecurring.raw.seriesDates.length}\n`);

  console.log('✅ All tests completed!');
}

// Run tests
testOccurrenceDetection().catch(console.error);
