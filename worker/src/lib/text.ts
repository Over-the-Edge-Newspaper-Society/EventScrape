/**
 * Shared text helpers for scraper modules.
 */

/**
 * Decode the HTML entities WordPress / CMS feeds commonly emit in titles,
 * categories and short text. Handles the named entities we see in practice
 * plus any remaining numeric (`&#1234;`) references.
 */
export function decodeEntities(input?: string | null): string {
  if (!input) return '';
  return input
    .replace(/&amp;/g, '&')
    .replace(/&#0?38;/g, '&')
    .replace(/&#8217;/g, '’')
    .replace(/&#8216;/g, '‘')
    .replace(/&#8220;/g, '“')
    .replace(/&#8221;/g, '”')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .trim();
}
