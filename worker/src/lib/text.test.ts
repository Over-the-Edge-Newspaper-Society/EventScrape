import { describe, it, expect } from 'vitest';
import { decodeEntities } from './text.js';

describe('decodeEntities', () => {
  it('decodes named ampersand/quote/dash entities', () => {
    expect(decodeEntities('Programs &amp; Lessons')).toBe('Programs & Lessons');
    expect(decodeEntities('Bricks &amp; Sips')).toBe('Bricks & Sips');
    expect(decodeEntities('a &quot;b&quot; c')).toBe('a "b" c');
    expect(decodeEntities('Bingo &#8211; Night')).toBe('Bingo – Night');
  });

  it('decodes numeric entities (padded and generic)', () => {
    expect(decodeEntities('Support &#038; Fun')).toBe('Support & Fun');
    expect(decodeEntities('We&#8217;re Closed!')).toBe('We’re Closed!');
    expect(decodeEntities('caf&#233;')).toBe('café');
  });

  it('handles empty/nullish input', () => {
    expect(decodeEntities(undefined)).toBe('');
    expect(decodeEntities(null)).toBe('');
    expect(decodeEntities('')).toBe('');
  });

  it('trims surrounding whitespace', () => {
    expect(decodeEntities('  hi  ')).toBe('hi');
  });
});
