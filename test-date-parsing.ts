// Test date parsing for Downtown PG events

const testDates = [
  { input: "Oct 25 2025", expected: "2025-10-25" },
  { input: "Nov 25 2025", expected: "2025-11-25" },
  { input: "Aug 27 2025", expected: "2025-08-27" },
  { input: "Sep 19 2025", expected: "2025-09-19" }
];

testDates.forEach(test => {
  const dateMatch = test.input.match(/(\w{3})\s+(\d{1,2})\s+(\d{4})/);
  
  if (dateMatch) {
    const [, month, day, year] = dateMatch;
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthIndex = monthNames.indexOf(month);
    
    if (monthIndex !== -1) {
      // This is the bug - JavaScript Date constructor uses 0-based months
      const date = new Date(parseInt(year), monthIndex, parseInt(day));
      const isoDate = date.toISOString().split('T')[0];
      
      console.log(`Input: ${test.input}`);
      console.log(`  Month: ${month} (index: ${monthIndex})`);
      console.log(`  Date created: ${date.toDateString()}`);
      console.log(`  ISO Date: ${isoDate}`);
      console.log(`  Expected: ${test.expected}`);
      console.log(`  Match: ${isoDate === test.expected ? '✓' : '✗'}`);
      console.log('---');
    }
  }
});