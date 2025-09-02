import { chromium } from 'playwright';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto('https://www.princegeorge.ca/community-culture/events/events-calendar', { waitUntil: 'networkidle', timeout: 60000 });

    // Wait for calendar header
    await page.waitForSelector('.fc-center h2', { timeout: 20000 });

    // Navigate to September 2025
    const targetMonthText = 'September 2025';
    let guard = 0;
    while (guard++ < 24) {
      const current = await page.$eval('.fc-center h2', el => el.textContent?.trim() || '');
      if (current.includes(targetMonthText)) break;
      await page.click('.fc-next-button');
      await page.waitForTimeout(800);
    }

    // Switch to list view if available
    const btn = await page.$('.fc-listMonth-button');
    if (btn) {
      await btn.click();
      await page.waitForTimeout(1500);
    }

    // Extract all list items and filter for the Car Seat Clinic
    const items = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.fc-list-item'));
      return rows.map(row => {
        const title = row.querySelector('.fc-list-item-title a')?.textContent?.trim() || '';
        const time = row.querySelector('.fc-list-item-time')?.textContent?.trim() || '';
        // Find date heading for this row
        let dateHeading = row.previousElementSibling;
        while (dateHeading && !dateHeading.classList.contains('fc-list-heading')) {
          dateHeading = dateHeading.previousElementSibling;
        }
        const date = dateHeading?.querySelector('.fc-list-heading-main')?.textContent?.trim() || '';
        const anchor = row.querySelector('.fc-list-item-title a');
        const href = anchor ? anchor.href : '';
        return { title, date, time, href };
      });
    });

    const clinic = items.filter(i => i.title?.toLowerCase().includes('car seat clinic at fire hall'));
    console.log(`Found ${clinic.length} "Car Seat Clinic" instances in list view for ${targetMonthText}`);
    clinic.forEach((i, idx) => console.log(`${idx + 1}. ${i.date} — ${i.time} — ${i.href}`));
  } finally {
    await page.close();
    await browser.close();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
