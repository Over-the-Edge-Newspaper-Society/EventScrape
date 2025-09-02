import { chromium } from 'playwright';
import pino from 'pino';

const logger = pino({
  transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' } }
});

async function run() {
  const url = 'https://www.princegeorge.ca/community-culture/arts-events/events-calendar/car-seat-clinic-fire-hall-1';
  logger.info(`Opening: ${url}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

    const details = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('.field--name-field-when .field__item'));
      const dates = nodes.map((item) => {
        const times = item.querySelectorAll('time[datetime]');
        const start = times[0]?.getAttribute('datetime') || null;
        const end = times[1]?.getAttribute('datetime') || null;
        return { start, end };
      }).filter(d => d.start);
      const title = document.querySelector('h1.page-title, .page-title')?.textContent?.trim() || '';
      return { title, count: dates.length, dates };
    });

    logger.info(`Title: ${details.title}`);
    logger.info(`Found ${details.count} date instance(s)`);
    details.dates.forEach((d, i) => logger.info(`${i+1}. ${d.start} -> ${d.end || ''}`));

    if (details.count >= 2) {
      logger.info('Looks like a series/recurring event is correctly present.');
    } else {
      logger.warn('Fewer than 2 dates found — verify the page or structure.');
    }
  } finally {
    await page.close();
    await browser.close();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });

