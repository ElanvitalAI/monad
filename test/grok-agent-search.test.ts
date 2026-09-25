// Shared Grok Agent-Tools search parser (src/grok/agent-search.ts).
// parseResponsesOutput is the flattener all three Grok search call-sites
// depend on, so it's guarded here in isolation (pure, no network).

import { describe, test, expect } from 'bun:test';
import { parseResponsesOutput } from '../src/grok/agent-search';

describe('parseResponsesOutput', () => {
  test('flattens message text + annotations + search_call sources, deduped', () => {
    const r = parseResponsesOutput({
      output: [
        { type: 'reasoning', summary: [] },
        { type: 'web_search_call', action: { sources: [
          { type: 'url', url: 'https://a.com', title: 'A' },
          { type: 'url', url: 'https://b.com' },
        ] } },
        { type: 'message', content: [{
          type: 'output_text',
          text: 'Answer body.',
          annotations: [
            { type: 'url_citation', url: 'https://a.com', title: '1' }, // dup url, numeric title
            { type: 'url_citation', url: 'https://c.com', title: 'C site' },
          ],
        }] },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.text).toBe('Answer body.');
    // a.com from annotation first (numeric title dropped → no title), then
    // c.com (real title), then b.com from the search_call. a.com deduped.
    expect(r.citations.map(c => c.url)).toEqual(['https://a.com', 'https://c.com', 'https://b.com']);
    expect(r.citations.find(c => c.url === 'https://a.com')?.title).toBeUndefined(); // "1" dropped
    expect(r.citations.find(c => c.url === 'https://c.com')?.title).toBe('C site');
    expect(r.citations.find(c => c.url === 'https://a.com')).toBeDefined();
  });

  test('x_search_call sources are included too', () => {
    const r = parseResponsesOutput({
      output: [
        { type: 'x_search_call', action: { sources: [{ type: 'url', url: 'https://x.com/post/1' }] } },
        { type: 'message', content: [{ type: 'output_text', text: 'X says hi', annotations: [] }] },
      ],
    });
    expect(r.text).toBe('X says hi');
    expect(r.citations.map(c => c.url)).toEqual(['https://x.com/post/1']);
  });

  test('empty / malformed output is fail-soft (empty text, no citations)', () => {
    expect(parseResponsesOutput({ output: [] })).toMatchObject({ ok: true, text: '', citations: [] });
    expect(parseResponsesOutput(null)).toMatchObject({ ok: true, text: '', citations: [] });
    expect(parseResponsesOutput({})).toMatchObject({ ok: true, text: '', citations: [] });
  });
});
