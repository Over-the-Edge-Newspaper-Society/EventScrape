import type { CalendarEventLink } from '../types.js';

export const navigateToMonth = async (page: any, logger: any, targetYear: number, targetMonth: number): Promise<void> => {
  const currentMonthText = await page.$eval('.fc-center h2', (el: HTMLElement) => el.textContent?.trim() || '');
  logger.info(`Current calendar month: ${currentMonthText}`);

  const currentDate = new Date(currentMonthText + ' 1');
  const currentYear = currentDate.getFullYear();
  const currentMonthIndex = currentDate.getMonth();

  const targetDate = new Date(targetYear, targetMonth, 1);
  logger.info(
    `Navigating from ${currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} to ${targetDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
  );

  const monthsToNavigate = (targetYear - currentYear) * 12 + (targetMonth - currentMonthIndex);

  if (monthsToNavigate === 0) {
    logger.info('Already at target month');
    return;
  }

  const isForward = monthsToNavigate > 0;
  const buttonSelector = isForward ? '.fc-next-button' : '.fc-prev-button';
  const clicks = Math.abs(monthsToNavigate);

  logger.info(`Need to ${isForward ? 'forward' : 'backward'} navigate ${clicks} month${clicks === 1 ? '' : 's'}`);

  for (let i = 0; i < clicks; i++) {
    logger.info(`Navigation click ${i + 1}/${clicks}`);

    await page.waitForSelector(buttonSelector, { timeout: 5000 });
    await page.click(buttonSelector);
    await page.waitForTimeout(1000);

    const newMonthText = await page.$eval('.fc-center h2', (el: HTMLElement) => el.textContent?.trim() || '');
    logger.info(`After click ${i + 1}: ${newMonthText}`);
  }

  const finalMonthText = await page.$eval('.fc-center h2', (el: HTMLElement) => el.textContent?.trim() || '');
  const finalDate = new Date(finalMonthText + ' 1');

  if (finalDate.getFullYear() === targetYear && finalDate.getMonth() === targetMonth) {
    logger.info(`Successfully navigated to ${finalMonthText}`);
  } else {
    logger.warn(
      `Navigation may have failed. Expected: ${targetDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}, Got: ${finalMonthText}`,
    );
  }
};

export const extractEventsFromCurrentMonth = async (
  page: any,
  logger: any,
  startDate: Date,
  endDate: Date,
): Promise<CalendarEventLink[]> => {
  let useListView = false;

  try {
    const currentViewClass = await page.evaluate(() => {
      const viewEl = document.querySelector('.fc-view');
      return viewEl?.className ?? '';
    });

    if (currentViewClass.includes('fc-listMonth-view')) {
      useListView = true;
    } else {
      const listButton = await page.$('.fc-listMonth-button');
      if (listButton) {
        logger.info('Switching to list view for consistent event parsing');
        await listButton.click();
        await page.waitForSelector('.fc-list-table', { timeout: 10000 });
        useListView = true;
      }
    }
  } catch (error) {
    logger.warn(`Unable to switch to list view, falling back to month view: ${error instanceof Error ? error.message : error}`);
  }

  if (useListView) {
    await page.waitForSelector('.fc-list-table', { timeout: 10000 });
    const listCount = await page.$$eval('.fc-list-item', rows => rows.length);
    logger.info(`Found ${listCount} events in list view`);
  } else {
    const monthViewCount = await page.$$eval('.fc-event', nodes => nodes.length);
    logger.info(`Found ${monthViewCount} events in month view`);
  }

  const eventLinks = await page.evaluate(useList => {
    const links: any[] = [];

    if (useList) {
      const eventRows = document.querySelectorAll('.fc-list-item');

      eventRows.forEach(row => {
        const linkEl = row.querySelector('.fc-list-item-title a') as HTMLAnchorElement;
        const timeEl = row.querySelector('.fc-list-item-time');

        if (linkEl && timeEl) {
          let dateHeading = row.previousElementSibling;
          while (dateHeading && !dateHeading.classList.contains('fc-list-heading')) {
            dateHeading = dateHeading.previousElementSibling;
          }

          const dateText = dateHeading?.querySelector('.fc-list-heading-main')?.textContent?.trim() || '';

          const dataStart = (row as HTMLElement).getAttribute('data-start') || (linkEl as HTMLElement | null)?.getAttribute?.('data-start') || null;
          const dataEnd = (row as HTMLElement).getAttribute('data-end') || (linkEl as HTMLElement | null)?.getAttribute?.('data-end') || null;

          links.push({
            url: new URL(linkEl.href, window.location.origin).href,
            title: linkEl.textContent?.trim() || '',
            time: timeEl.textContent?.trim() || '',
            date: dateText,
            dataStart,
            dataEnd,
            rawDateText: dateHeading?.textContent?.trim() || null,
          });
        }
      });
    } else {
      const eventElements = Array.from(document.querySelectorAll('.fc-event'));

      const getElementChildren = (node: Element | null) => {
        if (!node) return [] as HTMLElement[];
        return Array.from(node.children) as HTMLElement[];
      };

      eventElements.forEach(eventEl => {
        const linkEl = eventEl as HTMLAnchorElement;

        let actualLink = linkEl;
        if (!linkEl.href) {
          const linkChild = linkEl.querySelector('a') as HTMLAnchorElement | null;
          if (linkChild?.href) {
            actualLink = linkChild;
          } else {
            return;
          }
        }

        const contentDiv = (eventEl as HTMLElement).querySelector('.fc-content');
        const titleEl = contentDiv?.querySelector('.fc-title') || eventEl.querySelector('.fc-title');
        const timeEl = contentDiv?.querySelector('.fc-time') || eventEl.querySelector('.fc-time');

        if (!titleEl || !actualLink.href) {
          return;
        }

        let dateText = '';
        let rawDateText: string | null = null;

        const dayCell = actualLink.closest('[data-date]');
        if (dayCell) {
          dateText = dayCell.getAttribute('data-date') || '';
          rawDateText = (dayCell as HTMLElement).textContent?.trim() || null;
        }

        if (!dateText) {
          const td = actualLink.closest('td');
          const row = td?.parentElement;
          const siblingCells = getElementChildren(row ?? null);
          const columnIndex = td ? siblingCells.indexOf(td as HTMLElement) : -1;

          if (td && columnIndex >= 0) {
            const fcRow = td.closest('.fc-row');
            const bgRow = fcRow?.querySelector('.fc-bg tr');
            if (bgRow) {
              const bgCells = getElementChildren(bgRow);
              let runningIndex = 0;
              let targetCell: HTMLElement | undefined;

              for (const cell of bgCells) {
                const span = parseInt(cell.getAttribute('colspan') || '1', 10) || 1;
                if (columnIndex < runningIndex + span) {
                  targetCell = cell;
                  break;
                }
                runningIndex += span;
              }

              if (!targetCell) {
                targetCell = bgCells[columnIndex];
              }

              if (targetCell) {
                dateText = targetCell.getAttribute('data-date') || '';
                rawDateText = rawDateText || targetCell.textContent?.trim() || null;
              }
            }
          }
        }

        const dataStart = (actualLink as HTMLElement).getAttribute('data-start') || null;
        const dataEnd = (actualLink as HTMLElement).getAttribute('data-end') || null;

        links.push({
          url: new URL(actualLink.href, window.location.origin).href,
          title: titleEl.textContent?.trim() || '',
          time: timeEl?.textContent?.trim() || '',
          date: dateText,
          dataStart,
          dataEnd,
          rawDateText,
        });
      });
    }

    return links;
  }, useListView);

  const filteredEvents = eventLinks.filter(event => {
    if (!startDate || !endDate) return true;

    try {
      let eventDate: Date;
      if (event.date) {
        if (event.date.match(/^\d{4}-\d{2}-\d{2}$/)) {
          eventDate = new Date(event.date + 'T00:00:00');
        } else {
          eventDate = new Date(event.date);
        }

        if (isNaN(eventDate.getTime())) {
          logger.warn(`Could not parse date for event: ${event.title}, date: ${event.date}`);
          return true;
        }
      } else {
        logger.warn(`Event has no date: ${event.title}`);
        return true;
      }

      const eventDateOnly = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
      const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
      const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

      const isInRange = eventDateOnly >= startDateOnly && eventDateOnly <= endDateOnly;

      if (!isInRange) {
        logger.debug(`Event ${event.title} (${event.date}) is outside date range ${startDate.toDateString()} - ${endDate.toDateString()}`);
      }

      return isInRange;
    } catch (error) {
      logger.warn(`Error filtering event: ${event.title}, date: ${event.date}, error: ${error}`);
      return true;
    }
  });

  logger.info(
    `Extracted ${eventLinks.length} events, ${filteredEvents.length} within date range (${startDate.toDateString()} - ${endDate.toDateString()})`,
  );
  return filteredEvents;
};

