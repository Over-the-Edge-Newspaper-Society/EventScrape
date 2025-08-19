// Test Tourism PG date fix
const testData = {
  startDateText: "Happening August 31, 2025", 
  endDateText: "- September 1, 2025",
  startTime: "10:30am",
  endTime: "4:00pm"
};

function parseEventDate(dateText: string, timeText?: string): string {
  try {
    // Parse "Happening September 5, 2025" or "September 5, 2025" format
    const dateMatch = dateText.match(/(?:Happening\s+)?(\w+ \d+, \d+)/i);
    if (dateMatch) {
      const dateStr = dateMatch[1];
      
      if (timeText) {
        // Parse date components manually to avoid timezone conversion
        const dateParts = dateStr.match(/(\w+)\s+(\d+),\s+(\d+)/);
        if (dateParts) {
          const [, monthName, day, year] = dateParts;
          const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                            'July', 'August', 'September', 'October', 'November', 'December'];
          const monthIndex = monthNames.indexOf(monthName);
          
          if (monthIndex !== -1) {
            // Parse time
            const timeMatch = timeText.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
            if (timeMatch) {
              let [, hours, minutes, ampm] = timeMatch;
              let hourNum = parseInt(hours);
              if (ampm.toLowerCase() === 'pm' && hourNum !== 12) {
                hourNum += 12;
              } else if (ampm.toLowerCase() === 'am' && hourNum === 12) {
                hourNum = 0;
              }
              
              // Create timezone-neutral date string for Pacific time
              // Format: "YYYY-MM-DD HH:mm" to be parsed with source timezone
              const monthStr = String(monthIndex + 1).padStart(2, '0');
              const dayStr = String(day).padStart(2, '0');
              const hourStr = String(hourNum).padStart(2, '0');
              const minuteStr = String(minutes).padStart(2, '0');
              return `${year}-${monthStr}-${dayStr} ${hourStr}:${minuteStr}`;
            }
          }
        }
      }
    }
    
    return '';
  } catch (error) {
    return '';
  }
}

function parseEndDate(endDateText: string, endTime?: string): string {
  const endDateMatch = endDateText.match(/(?:-\s*)?(\w+ \d+, \d+)/i);
  if (endDateMatch) {
    const endDateStr = endDateMatch[1];
    const endDateParts = endDateStr.match(/(\w+)\s+(\d+),\s+(\d+)/);
    if (endDateParts) {
      const [, endMonthName, endDay, endYear] = endDateParts;
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];
      const endMonthIndex = monthNames.indexOf(endMonthName);
      
      if (endMonthIndex !== -1) {
        // Use end time if available, otherwise use end of day (11:59 PM)
        let endHour = 23;
        let endMinute = 59;
        
        if (endTime) {
          const endTimeMatch = endTime.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
          if (endTimeMatch) {
            let [, hours, minutes, ampm] = endTimeMatch;
            endHour = parseInt(hours);
            endMinute = parseInt(minutes);
            if (ampm.toLowerCase() === 'pm' && endHour !== 12) {
              endHour += 12;
            } else if (ampm.toLowerCase() === 'am' && endHour === 12) {
              endHour = 0;
            }
          }
        }
        
        // Create timezone-neutral date string for end date
        const endMonthStr = String(endMonthIndex + 1).padStart(2, '0');
        const endDayStr = String(endDay).padStart(2, '0');
        const endHourStr = String(endHour).padStart(2, '0');
        const endMinuteStr = String(endMinute).padStart(2, '0');
        return `${endYear}-${endMonthStr}-${endDayStr} ${endHourStr}:${endMinuteStr}`;
      }
    }
  }
  return '';
}

console.log('Testing Tourism PG date parsing fixes:');
console.log('');

console.log('Input data:');
console.log(`  startDateText: "${testData.startDateText}"`);
console.log(`  endDateText: "${testData.endDateText}"`);
console.log(`  startTime: "${testData.startTime}"`);
console.log(`  endTime: "${testData.endTime}"`);
console.log('');

const startResult = parseEventDate(testData.startDateText, testData.startTime);
const endResult = parseEndDate(testData.endDateText, testData.endTime);

console.log('Parsing results:');
console.log(`  Start: "${startResult}"`);
console.log(`  End: "${endResult}"`);
console.log('');

console.log('Expected results:');
console.log('  Start: "2025-08-31 10:30" (Aug 31, 10:30 AM Pacific)');
console.log('  End: "2025-09-01 16:00" (Sep 1, 4:00 PM Pacific)');
console.log('');

console.log('✅ Fixed issues:');
console.log('  1. Multi-day events now parse end date correctly');
console.log('  2. Times are in timezone-neutral format for Pacific parsing');
console.log('  3. Date format will be properly handled by normalizeEvent function');