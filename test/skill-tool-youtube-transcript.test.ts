import { describe, expect, test } from 'bun:test';

import {
  extractYoutubeVideoId,
  dispatchYoutubeTranscript,
  youtubeTranscriptProbe,
  buildYoutubeTranscriptTool,
} from '../src/skills/tools/youtube-transcript.js';

describe('extractYoutubeVideoId', () => {
  test('parses standard watch URLs', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))
      .toBe('dQw4w9WgXcQ');
  });

  test('parses youtu.be short URLs', () => {
    expect(extractYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ'))
      .toBe('dQw4w9WgXcQ');
  });

  test('parses shorts URLs', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'))
      .toBe('dQw4w9WgXcQ');
  });

  test('parses embed URLs', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ'))
      .toBe('dQw4w9WgXcQ');
  });

  test('returns null on non-YouTube URLs', () => {
    expect(extractYoutubeVideoId('https://vimeo.com/123')).toBeNull();
  });
});

describe('buildYoutubeTranscriptTool', () => {
  test('schema names url as required', () => {
    const t = buildYoutubeTranscriptTool();
    expect(t.name).toBe('YoutubeTranscript');
    const p = t.parameters as { required?: string[]; properties: Record<string, unknown> };
    expect(p.required).toContain('url');
    expect(p.properties.lang).toBeDefined();
    expect(p.properties.max_bytes).toBeDefined();
  });
});

describe('dispatchYoutubeTranscript', () => {
  test('throws when url is empty', async () => {
    await expect(dispatchYoutubeTranscript({ url: '' })).rejects.toThrow(/url.*required/);
  });

  test('throws when url lacks a video id', async () => {
    await expect(dispatchYoutubeTranscript({ url: 'https://example.com/other' }))
      .rejects.toThrow(/extract YouTube video id/);
  });

  test('returns provider=none when SUPADATA_API_KEY is absent', async () => {
    const prior = process.env['SUPADATA_API_KEY'];
    delete process.env['SUPADATA_API_KEY'];
    try {
      const r = await dispatchYoutubeTranscript(
        { url: 'https://youtu.be/dQw4w9WgXcQ' },
        { fetchImpl: (async () => new Response()) as unknown as typeof fetch },
      );
      expect(r.provider).toBe('none');
      expect(r.text).toBe('');
      expect(r.output).toContain('SUPADATA_API_KEY');
    } finally {
      if (prior !== undefined) process.env['SUPADATA_API_KEY'] = prior;
    }
  });

  test('happy path via fake Supadata returning segments', async () => {
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      expect(url).toContain('api.supadata.ai/v1/transcript');
      expect(url).toContain('lang=ko');
      return new Response(JSON.stringify({
        content: [
          { text: 'hello', start: 0, duration: 1000 },
          { text: 'world', start: 1000, duration: 1500 },
        ],
        lang: 'ko',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const r = await dispatchYoutubeTranscript(
      { url: 'https://youtu.be/dQw4w9WgXcQ' },
      { fetchImpl: fakeFetch, apiKey: 'test-key' },
    );
    expect(r.provider).toBe('supadata');
    expect(r.videoId).toBe('dQw4w9WgXcQ');
    expect(r.text).toBe('hello world');
    expect(r.segments).toHaveLength(2);
    expect(r.segments[0]!.offset).toBe(0);
    expect(r.segments[0]!.duration).toBe(1);
    expect(r.durationSec).toBe(3);   // 1.0 + 1.5 = 2.5 rounded up to 3
    expect(r.output).toContain('segments=2');
  });

  test('plain-text content returns empty segments but full text', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ content: 'plain transcript body' }), { status: 200 });
    const r = await dispatchYoutubeTranscript(
      { url: 'https://youtu.be/abcdefghijk' },
      { fetchImpl: fakeFetch, apiKey: 'k' },
    );
    expect(r.text).toBe('plain transcript body');
    expect(r.segments).toHaveLength(0);
    expect(r.durationSec).toBeNull();
  });

  test('503 from Supadata surfaces as provider=none with hint', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response('upstream error', { status: 503 });
    const r = await dispatchYoutubeTranscript(
      { url: 'https://youtu.be/abcdefghijk' },
      { fetchImpl: fakeFetch, apiKey: 'k' },
    );
    expect(r.provider).toBe('none');
    expect(r.output).toContain('503');
    expect(r.output).toContain('youtube-master');
  });

  test('fetch throw surfaces as provider=none', async () => {
    const fakeFetch: typeof fetch = async () => { throw new Error('network down'); };
    const r = await dispatchYoutubeTranscript(
      { url: 'https://youtu.be/abcdefghijk' },
      { fetchImpl: fakeFetch, apiKey: 'k' },
    );
    expect(r.provider).toBe('none');
    expect(r.output).toContain('network down');
  });

  test('max_bytes triggers the spilled-output path for oversized transcripts', async () => {
    // 20 KB body vs. 10 KB inline cap → truncateOutput spills to
    // disk and returns head+footer+tail. Landing asserts on the
    // truncated flag and the footer hint; exact bytes depend on
    // output-truncation's default head/tail slice sizes.
    const bigText = 'x'.repeat(20_000);
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ content: bigText }), { status: 200 });
    const r = await dispatchYoutubeTranscript(
      { url: 'https://youtu.be/abcdefghijk', max_bytes: 10_000 },
      { fetchImpl: fakeFetch, apiKey: 'k' },
    );
    expect(r.truncated).toBe(true);
    expect(r.text).toContain('bytes elided');
  });

  test('lang param overrides env default', async () => {
    let capturedUrl = '';
    const fakeFetch: typeof fetch = async (input) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ content: [] }), { status: 200 });
    };
    await dispatchYoutubeTranscript(
      { url: 'https://youtu.be/abcdefghijk', lang: 'en' },
      { fetchImpl: fakeFetch, apiKey: 'k' },
    );
    expect(capturedUrl).toContain('lang=en');
  });
});

describe('youtubeTranscriptProbe', () => {
  test('reflects SUPADATA_API_KEY env presence', () => {
    const prior = process.env['SUPADATA_API_KEY'];
    try {
      delete process.env['SUPADATA_API_KEY'];
      expect(youtubeTranscriptProbe()).toBe(false);
      process.env['SUPADATA_API_KEY'] = 'test';
      expect(youtubeTranscriptProbe()).toBe(true);
    } finally {
      if (prior === undefined) delete process.env['SUPADATA_API_KEY'];
      else process.env['SUPADATA_API_KEY'] = prior;
    }
  });
});
