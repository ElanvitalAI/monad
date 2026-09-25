// R-OCR follow-up — handleNotesFromImages (batch) handler contract.
//
// Mirrors the singular sibling test (`notes-from-image.test.ts`) but
// exercises the batch envelope: per-image result entries, shared
// polishMode + strengths, partial failure isolation, and the
// max-images cap.
//
// Cross-ref:
//   src/nexus/api/notes-from-images.ts (handler)
//   test/notes-from-image.test.ts (singular sibling)

import { describe, expect, test } from 'bun:test';

import {
  OcrProvider,
  OcrRegistry,
  type OcrCapabilities,
  type OcrInput,
  type OcrResult,
} from '../src/ocr/index.js';
import {
  handleNotesFromImages,
} from '../src/nexus/api/notes-from-images.js';
import type { PolishCallable } from '../src/nexus/api/notes-from-image.js';

class FakeProvider extends OcrProvider {
  readonly name = 'fake';
  readonly capabilities: OcrCapabilities = {
    languages: ['*', 'ko'],
    outputs: ['markdown'],
    inputs: ['image/*'],
    strengths: ['korean', 'handwriting'],
    costPerPageUsd: 0.005,
  };
  callCount = 0;
  lastFilenames: string[] = [];
  constructor(private readonly impl: (input: OcrInput, idx: number) => Promise<OcrResult>) {
    super();
  }
  isAvailable(): boolean { return true; }
  async run(input: OcrInput): Promise<OcrResult> {
    const idx = this.callCount;
    this.callCount += 1;
    this.lastFilenames.push(input.filename);
    return this.impl(input, idx);
  }
}

function makeRegistry(provider: OcrProvider | null): OcrRegistry {
  const reg = new OcrRegistry();
  if (provider) reg.register(provider);
  return reg;
}

function makePngBlob(): Blob {
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new Blob([sig], { type: 'image/png' });
}

function makeRequest(form: FormData): Request {
  return new Request('http://localhost/v1/notes/from-images', {
    method: 'POST',
    body: form,
  });
}

describe('handleNotesFromImages · CORS preflight', () => {
  test('OPTIONS → 204', async () => {
    const req = new Request('http://localhost/v1/notes/from-images', { method: 'OPTIONS' });
    const res = await handleNotesFromImages(req, { registry: makeRegistry(null) });
    expect(res.status).toBe(204);
  });
});

describe('handleNotesFromImages · dep-injection seam', () => {
  test('registry omitted → 503', async () => {
    const form = new FormData();
    form.append('image', makePngBlob(), 'a.png');
    const res = await handleNotesFromImages(makeRequest(form), {});
    expect(res.status).toBe(503);
  });

  test('non-POST → 405', async () => {
    const req = new Request('http://localhost/v1/notes/from-images', { method: 'GET' });
    const res = await handleNotesFromImages(req, { registry: makeRegistry(null) });
    expect(res.status).toBe(405);
  });

  test('non-multipart → 400', async () => {
    const req = new Request('http://localhost/v1/notes/from-images', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const res = await handleNotesFromImages(req, { registry: makeRegistry(null) });
    expect(res.status).toBe(400);
  });

  test('zero images → 400', async () => {
    const form = new FormData();
    const provider = new FakeProvider(async () => ({
      ok: true, provider: 'fake', text: '', markdown: 'x', html: '', raw: {},
    }));
    const res = await handleNotesFromImages(makeRequest(form), { registry: makeRegistry(provider) });
    expect(res.status).toBe(400);
  });
});

describe('handleNotesFromImages · success envelope', () => {
  test('two images · all OK · results aligned', async () => {
    const form = new FormData();
    form.append('image', makePngBlob(), 'a.png');
    form.append('image', makePngBlob(), 'b.png');
    form.append('filename', 'a.png');
    form.append('filename', 'b.png');
    const provider = new FakeProvider(async (_input, idx) => ({
      ok: true,
      provider: 'fake',
      text: '',
      markdown: `result-${idx}`,
      html: '',
      raw: {},
    }));
    const res = await handleNotesFromImages(makeRequest(form), {
      registry: makeRegistry(provider),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.succeeded).toBe(2);
    expect(body.failed).toBe(0);
    expect(body.results.length).toBe(2);
    expect(body.results[0].markdown).toBe('result-0');
    expect(body.results[1].markdown).toBe('result-1');
    expect(body.results[0].polishMode).toBe('minimal');
    expect(body.results[0].usedLlmPolish).toBe(false);
    expect(provider.lastFilenames).toEqual(['a.png', 'b.png']);
  });

  test('partial failure isolated · second image surfaces ocr_provider_threw', async () => {
    const form = new FormData();
    form.append('image', makePngBlob(), 'good.png');
    form.append('image', makePngBlob(), 'bad.png');
    const provider = new FakeProvider(async (_input, idx) => {
      if (idx === 1) throw new Error('boom');
      return { ok: true, provider: 'fake', text: '', markdown: `m-${idx}`, html: '', raw: {} };
    });
    const res = await handleNotesFromImages(makeRequest(form), {
      registry: makeRegistry(provider),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.results[0].ok).toBe(true);
    expect(body.results[1].ok).toBe(false);
    expect(body.results[1].error).toBe('ocr_provider_threw');
    expect(body.results[1].reason).toContain('boom');
  });

  test('empty image entry surfaces bad_request inline · others still run', async () => {
    const form = new FormData();
    const empty = new Blob([], { type: 'image/png' });
    form.append('image', empty, 'empty.png');
    form.append('image', makePngBlob(), 'good.png');
    const provider = new FakeProvider(async () => ({
      ok: true, provider: 'fake', text: '', markdown: 'ok', html: '', raw: {},
    }));
    const res = await handleNotesFromImages(makeRequest(form), {
      registry: makeRegistry(provider),
    });
    const body = await res.json();
    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.results[0].ok).toBe(false);
    expect(body.results[0].reason).toContain('empty');
    expect(body.results[1].ok).toBe(true);
  });
});

describe('handleNotesFromImages · max-images cap', () => {
  test('over the cap → 400 too_many_images', async () => {
    const form = new FormData();
    for (let i = 0; i < 9; i += 1) form.append('image', makePngBlob(), `i-${i}.png`);
    const provider = new FakeProvider(async () => ({
      ok: true, provider: 'fake', text: '', markdown: 'x', html: '', raw: {},
    }));
    const res = await handleNotesFromImages(makeRequest(form), {
      registry: makeRegistry(provider),
      maxImages: 8,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain('too_many_images');
  });
});

describe('handleNotesFromImages · enrich + polish degrade', () => {
  test('polish callable throws → entry stays ok=true with usedLlmPolish=false', async () => {
    const form = new FormData();
    form.append('image', makePngBlob(), 'a.png');
    form.append('polishMode', 'enrich');
    const provider = new FakeProvider(async () => ({
      ok: true, provider: 'fake', text: '', markdown: 'raw-md', html: '', raw: {},
    }));
    const polish: PolishCallable = async () => { throw new Error('llm down'); };
    const res = await handleNotesFromImages(makeRequest(form), {
      registry: makeRegistry(provider),
      polish,
    });
    const body = await res.json();
    expect(body.results[0].ok).toBe(true);
    expect(body.results[0].markdown).toBe('raw-md');
    expect(body.results[0].usedLlmPolish).toBe(false);
  });

  test('polish callable returns text → usedLlmPolish=true with polished markdown', async () => {
    const form = new FormData();
    form.append('image', makePngBlob(), 'a.png');
    form.append('polishMode', 'enrich');
    const provider = new FakeProvider(async () => ({
      ok: true, provider: 'fake', text: '', markdown: 'raw-md', html: '', raw: {},
    }));
    const polish: PolishCallable = async ({ rawMarkdown }) => `# polished\n\n${rawMarkdown}`;
    const res = await handleNotesFromImages(makeRequest(form), {
      registry: makeRegistry(provider),
      polish,
    });
    const body = await res.json();
    expect(body.results[0].ok).toBe(true);
    expect(body.results[0].usedLlmPolish).toBe(true);
    expect(body.results[0].markdown).toContain('# polished');
  });
});
