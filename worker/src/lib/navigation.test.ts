import { it, expect, vi } from 'vitest';
import { navigateToPage } from './navigation.js';

it('reports a blocked page as HTTP 403 and preserves the fetched-page count', async () => {
  const stats = { pagesCrawled: 0 };
  const page = { goto: vi.fn().mockResolvedValue({ ok: () => false, status: () => 403 }), url: () => 'https://tourismpg.com/explore/events/' };
  await expect(navigateToPage(page as any, page.url(), stats)).rejects.toThrow('HTTP 403');
  expect(stats.pagesCrawled).toBe(1);
});
