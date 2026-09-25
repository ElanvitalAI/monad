// R-OCR.1.5 — handleNotesFromImage handler contract.
//
// Covers the seven branches the handler can land on:
//   1. CORS preflight (OPTIONS)
//   2. registry-not-wired → 503
//   3. bad multipart body → 400
//   4. polishMode='minimal' (default) → raw OCR markdown
//   5. polishMode='enrich' + polish wired → polished markdown
//   6. polishMode='enrich' + polish throws → degrade to raw + usedLlmPolish=false
//   7. OCR provider failure → status mapped per stage
//   8. No provider available → 503
//
// Cross-ref:
//   src/nexus/api/notes-from-image.ts (handler)
//   src/ocr/index.ts (OcrProvider · OcrRegistry)
//   내부 문서 `ROADMAP-pwa-pre-ios-gap-2026-05-09` §R-OCR.1

import { describe, expect, test } from 'bun:test';

import {
  OcrProvider,
  OcrRegistry,
  type OcrCapabilities,
  type OcrInput,
  type OcrResult,
} from '../src/ocr/index.js';
import {
  handleNotesFromImage,
  type PolishCallable,
} from '../src/nexus/api/notes-from-image.js';

class FakeProvider extends OcrProvider {
  readonly name = 'fake';
  readonly capabilities: OcrCapabilities = {
    languages: ['*', 'ko', 'en'],
    outputs: ['text', 'markdown', 'html'],
    inputs: ['image/*'],
    strengths: ['korean'],
    costPerPageUsd: 0.005,
  };
  constructor(
    private readonly impl: (input: OcrInput) => Promise<OcrResult>,
    private readonly available = true,
  ) { super(); }
  isAvailable(): boolean { return this.available; }
  async run(input: OcrInput): Promise<OcrResult> { return this.impl(input); }
}

function makeRegistry(provider: OcrProvider | null): OcrRegistry {
  const reg = new OcrRegistry();
  if (provider) reg.register(provider);
  return reg;
}

function makeMultipart(form: FormData): Request {
  return new Request('http://localhost/v1/notes/from-image', {
    method: 'POST',
    body: form,
  });
}

function makePngBlob(): Blob {
  // Minimal valid PNG header (8-byte signature) — not a real image
  // but enough to be non-empty Buffer with image/* mime.
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new Blob([sig], { type: 'image/png' });
}

describe('handleNotesFromImage · CORS preflight', () => {
  test('OPTIONS → 204 + CORS headers', async () => {
    const req = new Request('http://localhost/v1/notes/from-image', {
      method: 'OPTIONS',
    });
    const res = await handleNotesFromImage(req, { registry: makeRegistry(null) });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });
});

describe('handleNotesFromImage · dep-injection seam', () => {
  test('omitted registry → 503 ocr_registry_not_wired (no silent fallback)', async () => {
    const form = new FormData();
    form.append('image', makePngBlob(), 'test.png');
    const res = await handleNotesFromImage(makeMultipart(form), {});
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('ocr_registry_not_wired');
  });
});

describe('handleNotesFromImage · request validation', () => {
  test('non-multipart body → 400', async () => {
    const req = new Request('http://localhost/v1/notes/from-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await handleNotesFromImage(req, { registry: makeRegistry(null) });
    expect(res.status).toBe(400);
  });

  test('missing image field → 400', async () => {
    const form = new FormData();
    form.append('filename', 'x.png');
    const res = await handleNotesFromImage(makeMultipart(form), { registry: makeRegistry(null) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain('image');
  });

  test('empty image blob → 400', async () => {
    const form = new FormData();
    form.append('image', new Blob([], { type: 'image/png' }), 'empty.png');
    const res = await handleNotesFromImage(makeMultipart(form), { registry: makeRegistry(null) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toContain('empty');
  });

  test('GET → 405 (method_not_allowed)', async () => {
    const req = new Request('http://localhost/v1/notes/from-image', { method: 'GET' });
    const res = await handleNotesFromImage(req, { registry: makeRegistry(null) });
    expect(res.status).toBe(405);
  });
});

describe('handleNotesFromImage · polishMode=minimal (default)', () => {
  test('returns raw OCR markdown · usedLlmPolish=false · provider name surfaces', async () => {
    const provider = new FakeProvider(async () => ({
      ok: true,
      provider: 'fake',
      text: '한글 본문',
      markdown: '# 제목\n\n한글 본문',
      html: '',
      raw: {},
    }));
    const form = new FormData();
    form.append('image', makePngBlob(), 'note.png');
    const res = await handleNotesFromImage(makeMultipart(form), {
      registry: makeRegistry(provider),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.markdown).toBe('# 제목\n\n한글 본문');
    expect(body.provider).toBe('fake');
    expect(body.polishMode).toBe('minimal');
    expect(body.usedLlmPolish).toBe(false);
    expect(body.costEstimate.ocrUsd).toBeCloseTo(0.005, 4);
    expect(body.costEstimate.polishUsd).toBe(0);
  });

  test('OCR returns text-only · falls back to text as markdown', async () => {
    const provider = new FakeProvider(async () => ({
      ok: true,
      provider: 'fake',
      text: 'plain text fallback',
      markdown: '',
      html: '',
      raw: {},
    }));
    const form = new FormData();
    form.append('image', makePngBlob(), 'note.png');
    const res = await handleNotesFromImage(makeMultipart(form), {
      registry: makeRegistry(provider),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.markdown).toBe('plain text fallback');
  });

  test('explicit polishMode=minimal honored', async () => {
    const provider = new FakeProvider(async () => ({
      ok: true, provider: 'fake', text: 'a', markdown: 'a', html: '', raw: {},
    }));
    let polishCalled = 0;
    const polish: PolishCallable = async () => { polishCalled++; return 'should not run'; };
    const form = new FormData();
    form.append('image', makePngBlob(), 'note.png');
    form.append('polishMode', 'minimal');
    const res = await handleNotesFromImage(makeMultipart(form), {
      registry: makeRegistry(provider), polish,
    });
    expect(res.status).toBe(200);
    expect(polishCalled).toBe(0);
    const body = await res.json();
    expect(body.usedLlmPolish).toBe(false);
  });
});

describe('handleNotesFromImage · polishMode=enrich', () => {
  test('polish callable invoked · receives raw markdown + image bytes · polished markdown returned', async () => {
    const provider = new FakeProvider(async () => ({
      ok: true, provider: 'fake', text: 'raw', markdown: 'raw md', html: '', raw: {},
    }));
    let captured: { rawMarkdown?: string; mediaType?: string; base64Length?: number } = {};
    const polish: PolishCallable = async (input) => {
      captured = {
        rawMarkdown: input.rawMarkdown,
        mediaType: input.image.mediaType,
        base64Length: input.image.base64.length,
      };
      return '# Polished\n\nClean markdown';
    };
    const form = new FormData();
    form.append('image', makePngBlob(), 'note.png');
    form.append('polishMode', 'enrich');
    const res = await handleNotesFromImage(makeMultipart(form), {
      registry: makeRegistry(provider), polish,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.markdown).toBe('# Polished\n\nClean markdown');
    expect(body.polishMode).toBe('enrich');
    expect(body.usedLlmPolish).toBe(true);
    expect(captured.rawMarkdown).toBe('raw md');
    expect(captured.mediaType).toBe('image/png');
    expect(captured.base64Length).toBeGreaterThan(0);
  });

  test('polish callable not wired · degrades to raw markdown · usedLlmPolish=false', async () => {
    const provider = new FakeProvider(async () => ({
      ok: true, provider: 'fake', text: 'r', markdown: '# raw', html: '', raw: {},
    }));
    const form = new FormData();
    form.append('image', makePngBlob(), 'note.png');
    form.append('polishMode', 'enrich');
    const res = await handleNotesFromImage(makeMultipart(form), {
      registry: makeRegistry(provider),
      // polish omitted on purpose
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.markdown).toBe('# raw');
    expect(body.polishMode).toBe('enrich');
    expect(body.usedLlmPolish).toBe(false);
  });

  test('polish throws · degrades to raw markdown · 200 (not 502)', async () => {
    const provider = new FakeProvider(async () => ({
      ok: true, provider: 'fake', text: 'r', markdown: '# raw', html: '', raw: {},
    }));
    const polish: PolishCallable = async () => { throw new Error('llm rate limit'); };
    const form = new FormData();
    form.append('image', makePngBlob(), 'note.png');
    form.append('polishMode', 'enrich');
    const res = await handleNotesFromImage(makeMultipart(form), {
      registry: makeRegistry(provider), polish,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.markdown).toBe('# raw');
    expect(body.usedLlmPolish).toBe(false);
    expect(body.polishError).toBe('llm rate limit');
  });

  test('polish returns whitespace · degrades to raw markdown', async () => {
    const provider = new FakeProvider(async () => ({
      ok: true, provider: 'fake', text: '', markdown: '# raw', html: '', raw: {},
    }));
    const polish: PolishCallable = async () => '   \n   ';
    const form = new FormData();
    form.append('image', makePngBlob(), 'note.png');
    form.append('polishMode', 'enrich');
    const res = await handleNotesFromImage(makeMultipart(form), {
      registry: makeRegistry(provider), polish,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.markdown).toBe('# raw');
    expect(body.usedLlmPolish).toBe(false);
  });

  test('unknown polishMode value falls back to minimal', async () => {
    const provider = new FakeProvider(async () => ({
      ok: true, provider: 'fake', text: '', markdown: '# raw', html: '', raw: {},
    }));
    const polish: PolishCallable = async () => 'should not run';
    const form = new FormData();
    form.append('image', makePngBlob(), 'note.png');
    form.append('polishMode', 'aggressive');  // not in our union
    const res = await handleNotesFromImage(makeMultipart(form), {
      registry: makeRegistry(provider), polish,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.polishMode).toBe('minimal');
    expect(body.markdown).toBe('# raw');
  });
});

describe('handleNotesFromImage · OCR provider failure mapping', () => {
  test('stage=auth → 503 (config issue)', async () => {
    const provider = new FakeProvider(async () => ({
      ok: false, provider: 'fake', stage: 'auth', message: 'no api key',
    }));
    const form = new FormData();
    form.append('image', makePngBlob(), 'note.png');
    const res = await handleNotesFromImage(makeMultipart(form), {
      registry: makeRegistry(provider),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.stage).toBe('auth');
  });

  test('stage=unsupported → 415', async () => {
    const provider = new FakeProvider(async () => ({
      ok: false, provider: 'fake', stage: 'unsupported', message: 'bad mime',
    }));
    const form = new FormData();
    form.append('image', makePngBlob(), 'note.png');
    const res = await handleNotesFromImage(makeMultipart(form), {
      registry: makeRegistry(provider),
    });
    expect(res.status).toBe(415);
  });

  test('stage=http → 502 (upstream error)', async () => {
    const provider = new FakeProvider(async () => ({
      ok: false, provider: 'fake', stage: 'http', status: 500, message: 'upstream 500',
    }));
    const form = new FormData();
    form.append('image', makePngBlob(), 'note.png');
    const res = await handleNotesFromImage(makeMultipart(form), {
      registry: makeRegistry(provider),
    });
    expect(res.status).toBe(502);
  });

  test('provider.run throws → 502 ocr_provider_threw', async () => {
    const provider = new FakeProvider(async () => { throw new Error('network blew up'); });
    const form = new FormData();
    form.append('image', makePngBlob(), 'note.png');
    const res = await handleNotesFromImage(makeMultipart(form), {
      registry: makeRegistry(provider),
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('ocr_provider_threw');
    expect(body.reason).toContain('network blew up');
  });
});

describe('handleNotesFromImage · registry availability', () => {
  test('empty registry → 503 no_ocr_provider_available', async () => {
    const form = new FormData();
    form.append('image', makePngBlob(), 'note.png');
    const res = await handleNotesFromImage(makeMultipart(form), {
      registry: makeRegistry(null),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('no_ocr_provider_available');
  });

  test('all providers unavailable → 503', async () => {
    const provider = new FakeProvider(
      async () => ({ ok: true, provider: 'fake', text: '', markdown: '', html: '', raw: {} }),
      false,  // isAvailable=false
    );
    const form = new FormData();
    form.append('image', makePngBlob(), 'note.png');
    const res = await handleNotesFromImage(makeMultipart(form), {
      registry: makeRegistry(provider),
    });
    expect(res.status).toBe(503);
  });
});

describe('handleNotesFromImage · auth check seam', () => {
  test('checkAuth returns false → 401', async () => {
    const provider = new FakeProvider(async () => ({
      ok: true, provider: 'fake', text: '', markdown: '', html: '', raw: {},
    }));
    const form = new FormData();
    form.append('image', makePngBlob(), 'note.png');
    const res = await handleNotesFromImage(makeMultipart(form), {
      registry: makeRegistry(provider),
      checkAuth: () => false,
    });
    expect(res.status).toBe(401);
  });

  test('checkAuth returns true → request proceeds', async () => {
    const provider = new FakeProvider(async () => ({
      ok: true, provider: 'fake', text: '', markdown: '# ok', html: '', raw: {},
    }));
    const form = new FormData();
    form.append('image', makePngBlob(), 'note.png');
    const res = await handleNotesFromImage(makeMultipart(form), {
      registry: makeRegistry(provider),
      checkAuth: () => true,
    });
    expect(res.status).toBe(200);
  });
});
