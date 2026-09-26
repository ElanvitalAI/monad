// debug-bundle.test.ts — POST /v1/debug-bundle pipeline.
//
// All disk + S3 dependencies are seam-injected so the test never
// touches ~/.elanous/log or the real AWS CLI.

import { describe, expect, test } from 'bun:test';
import { buildAndUploadBundle, composePrompt, handleDebugBundlePost } from '../src/nexus/api/debug-bundle';

const FROZEN_NOW = new Date('2026-05-18T19:30:45.000Z');

function stubDeps(overrides: Partial<Parameters<typeof buildAndUploadBundle>[2]> = {}) {
  return {
    findLatestLog: overrides.findLatestLog ?? (() => '/tmp/fake-debug.log'),
    tailReader: overrides.tailReader ?? (async () => '[stub] daemon log tail'),
    uploader: overrides.uploader ?? (() => {}),
    available: overrides.available ?? (() => true),
  };
}

describe('buildAndUploadBundle', () => {
  test('happy path · returns S3 public URL + prompt + key', async () => {
    let uploadedKey = '';
    const result = await buildAndUploadBundle(
      { symptom: 'chat ladybug does not open companion popup', surface: 'chat', appLog: 'tap.button' },
      FROZEN_NOW,
      stubDeps({
        uploader: (_path, key) => { uploadedKey = key; },
      }),
    );
    expect(result.key).toContain('debug-bundle/');
    expect(result.key).toContain('2026-05-18-193045.md');
    expect(uploadedKey).toBe(result.key);
    expect(result.url).toContain('https://');
    expect(result.url).toContain('elanvital-public.s3.amazonaws.com');
    expect(result.url).toContain(result.key.split('/').map(encodeURIComponent).join('/'));
    expect(result.prompt).toContain('chat ladybug does not open companion popup');
    expect(result.prompt).toContain('## Bundle');
    expect(result.prompt).toContain(result.url);
  });

  test('missing daemon log gracefully degrades', async () => {
    const result = await buildAndUploadBundle(
      { symptom: 'no log on box' },
      FROZEN_NOW,
      stubDeps({ findLatestLog: () => null }),
    );
    expect(result.url).toContain('elanvital-public');
  });

  test('S3 unavailable → throws s3-not-configured', async () => {
    expect(
      buildAndUploadBundle(
        { symptom: 'x' },
        FROZEN_NOW,
        stubDeps({ available: () => false }),
      ),
    ).rejects.toThrow('s3-not-configured');
  });
});

describe('composePrompt', () => {
  test('includes symptom · surface · URL · 3 numbered analysis asks', () => {
    const p = composePrompt(
      { symptom: 'mic crash', surface: 'chat' },
      'https://example/bundle.md',
    );
    expect(p).toContain('mic crash');
    expect(p).toContain('chat');
    expect(p).toContain('https://example/bundle.md');
    expect(p).toMatch(/1\..+root cause|불일치/);
    expect(p).toMatch(/2\..+코드 변경/);
    expect(p).toMatch(/3\..+재현/);
  });

  test('fallback when symptom + surface missing', () => {
    const p = composePrompt({ symptom: '   ' }, 'https://x/y.md');
    expect(p).toContain('(no symptom provided)');
    expect(p).toContain('unspecified');
  });

  test('embeds screenshot URL when supplied — external LLM can fetch both sources from prompt alone', () => {
    const p = composePrompt(
      { symptom: 'visual glitch', surface: 'notes' },
      'https://example/bundle.md',
      'https://example/bundle.png',
    );
    expect(p).toContain('https://example/bundle.md');
    expect(p).toContain('https://example/bundle.png');
    expect(p).toContain('Screenshot');
    // Order check — screenshot section must come after the bundle URL
    // line so the LLM reads logs first then the visual.
    const mdIdx = p.indexOf('https://example/bundle.md');
    const pngIdx = p.indexOf('https://example/bundle.png');
    expect(pngIdx).toBeGreaterThan(mdIdx);
  });

  test('omits screenshot section when null', () => {
    const p = composePrompt(
      { symptom: 's', surface: 'chat' },
      'https://example/bundle.md',
      null,
    );
    expect(p).not.toContain('Screenshot');
  });
});

describe('handleDebugBundlePost · contract', () => {
  test('rejects missing symptom with 400', async () => {
    const req = new Request('https://h/v1/debug-bundle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ symptom: '' }),
    });
    const res = await handleDebugBundlePost(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('symptom-required');
  });

  test('rejects malformed JSON with 400', async () => {
    const req = new Request('https://h/v1/debug-bundle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });
    const res = await handleDebugBundlePost(req);
    expect(res.status).toBe(400);
  });
});
