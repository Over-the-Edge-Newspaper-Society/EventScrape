// Test the calendar date fix directly
function testDateFix() {
  const currentMonth = "August 2025";
  const dayNumber = "30";
  
  console.log('Testing calendar date fix:');
  console.log(`Input: currentMonth="${currentMonth}", dayNumber="${dayNumber}"`);
  
  // OLD CODE (broken):
  const oldEventDate = `${currentMonth} ${dayNumber}`;
  console.log(`Old result: "${oldEventDate}"`);
  
  // NEW CODE (fixed):
  const monthYearMatch = currentMonth.match(/(\w+)\s+(\d{4})/);
  let eventDate = currentMonth; // fallback
  
  if (monthYearMatch) {
    const [, month, year] = monthYearMatch;
    // Create properly formatted date: "August 30, 2025"
    eventDate = `${month} ${dayNumber}, ${year}`;
  } else {
    // If format doesn't match, try to create best effort date
    eventDate = `${currentMonth} ${dayNumber}`;
  }
  
  console.log(`New result: "${eventDate}"`);
  console.log(`Expected: "August 30, 2025"`);
  console.log(`Fix works: ${eventDate === "August 30, 2025" ? "✅ YES" : "❌ NO"}`);
  
  // Test timezone-neutral date creation
  console.log('\nTesting timezone-neutral date creation:');
  const year = 2025;
  const monthIndex = 7; // August (0-based: July=6, August=7)
  const day = 30;
  const hourNum = 10;
  const minutes = 30;
  
  // OLD CODE (broken):
  const oldDateObj = new Date(year, monthIndex, day, hourNum, minutes, 0, 0);
  const oldResult = oldDateObj.toISOString();
  console.log(`Old result: "${oldResult}" (converts to UTC)`);
  
  // NEW CODE (fixed):
  const monthStr = String(monthIndex + 1).padStart(2, '0');
  const dayStr = String(day).padStart(2, '0');
  const hourStr = String(hourNum).padStart(2, '0');
  const minuteStr = String(minutes).padStart(2, '0');
  const newResult = `${year}-${monthStr}-${dayStr} ${hourStr}:${minuteStr}`;
  console.log(`New result: "${newResult}" (timezone-neutral for Pacific parsing)`);
  console.log(`Expected: "2025-08-30 10:30"`);
  console.log(`Fix works: ${newResult === "2025-08-30 10:30" ? "✅ YES" : "❌ NO"}`);
}

testDateFix();