// CV-3 FP-B — /v1/showroom/layouts/* unit tests.
//
// Covers:
//   - parseShowroomLayoutPath edge cases
//   - list 200 (sorted desc by savedAt)
//   - get 200 / 404
//   - put 200 (overwrite) / 400 / 401 missing-name / name-too-long
//   - delete 200 / 404
//   - layout shape sanitization (kind/agentBrand/state validation)
//   - auth gate (bearer set + missing/correct header)

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  __setShowroomStoreForTest,
  _showroomLayoutsListenerCount,
  handleShowroomLayoutDelete,
  handleShowroomLayoutGet,
  handleShowroomLayoutPut,
  handleShowroomLayoutsEvents,
  handleShowroomLayoutsList,
  onShowroomLayoutsChange,
  parseShowroomLayoutPath,
  type ShowroomLayoutsEvent,
} from '../src/nexus/api/showroom-layouts.js';
import type { MetaApiOpts } from '../src/nexus/api/meta-api.js';

const opts: MetaApiOpts = { noAuth: true };

beforeEach(() => {
  __setShowroomStoreForTest({ layouts: {} });
});
afterEach(() => {
  __setShowroomStoreForTest(null);
});

function putReq(name: string, body: unknown): Request {
  return new Request(`http://localhost/v1/showroom/layouts/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function bareReq(url: string): Request {
  return new Request(url);
}

describe('parseShowroomLayoutPath', () => {
  test('matches /v1/showroom/layouts/:name', () => {
    expect(parseShowroomLayoutPath('/v1/showroom/layouts/morning')).toBe('morning');
  });

  test('decodes URL-escaped names', () => {
    expect(parseShowroomLayoutPath('/v1/showroom/layouts/with%20space')).toBe('with space');
  });

  test('rejects non-matching paths', () => {
    expect(parseShowroomLayoutPath('/v1/showroom/layouts')).toBeNull();
    expect(parseShowroomLayoutPath('/v1/showroom/layouts/a/b')).toBeNull();
    expect(parseShowroomLayoutPath('/v2/showroom/layouts/x')).toBeNull();
  });
});

describe('handleShowroomLayoutsList', () => {
  test('empty store → { layouts: [] }', async () => {
    const res = handleShowroomLayoutsList(bareReq('http://localhost/v1/showroom/layouts'), opts);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { layouts: unknown[] };
    expect(body.layouts).toEqual([]);
  });

  test('returns sorted desc by savedAt', async () => {
    __setShowroomStoreForTest({
      layouts: {
        old: { name: 'old', savedAt: 1000, panels: [] },
        new: { name: 'new', savedAt: 3000, panels: [] },
        mid: { name: 'mid', savedAt: 2000, panels: [] },
      },
    });
    const res = handleShowroomLayoutsList(bareReq('http://localhost/v1/showroom/layouts'), opts);
    const body = (await res.json()) as { layouts: Array<{ name: string }> };
    expect(body.layouts.map((l) => l.name)).toEqual(['new', 'mid', 'old']);
  });
});

describe('handleShowroomLayoutGet', () => {
  test('200 — found', async () => {
    __setShowroomStoreForTest({
      layouts: {
        morning: { name: 'morning', savedAt: 100, panels: [] },
      },
    });
    const res = handleShowroomLayoutGet(
      bareReq('http://localhost/v1/showroom/layouts/morning'),
      opts,
      'morning',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { layout: { name: string } };
    expect(body.layout.name).toBe('morning');
  });

  test('404 — missing', async () => {
    const res = handleShowroomLayoutGet(
      bareReq('http://localhost/v1/showroom/layouts/nope'),
      opts,
      'nope',
    );
    expect(res.status).toBe(404);
  });

  test('400 — empty name', async () => {
    const res = handleShowroomLayoutGet(bareReq('http://localhost/v1/showroom/layouts/'), opts, '');
    expect(res.status).toBe(400);
  });
});

describe('handleShowroomLayoutPut', () => {
  test('200 — saves new layout', async () => {
    const res = await handleShowroomLayoutPut(
      putReq('morning', {
        savedAt: 1234,
        panels: [
          { id: 'p1', kind: 'chat', provider: 'claude', state: 'live' },
          { id: 'a1', kind: 'agent', provider: 'codex', agentBrand: 'codex', state: 'live' },
        ],
        layoutMode: 'horizontal',
      }),
      opts,
      'morning',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      layout: { name: string; panels: unknown[]; layoutMode?: string };
    };
    expect(body.ok).toBe(true);
    expect(body.layout.name).toBe('morning');
    expect(body.layout.panels).toHaveLength(2);
    expect(body.layout.layoutMode).toBe('horizontal');
  });

  test('200 — overwrites existing', async () => {
    await handleShowroomLayoutPut(
      putReq('x', { panels: [{ id: 'p1', kind: 'chat', provider: '', state: 'live' }] }),
      opts,
      'x',
    );
    const res = await handleShowroomLayoutPut(
      putReq('x', { panels: [{ id: 'p2', kind: 'agent', provider: 'claude', agentBrand: 'claude', state: 'live' }] }),
      opts,
      'x',
    );
    expect(res.status).toBe(200);
    const list = handleShowroomLayoutsList(bareReq('http://localhost/v1/showroom/layouts'), opts);
    const body = (await list.json()) as { layouts: Array<{ panels: Array<{ id: string }> }> };
    expect(body.layouts).toHaveLength(1);
    expect(body.layouts[0]!.panels[0]!.id).toBe('p2');
  });

  test('400 — missing panels array', async () => {
    const res = await handleShowroomLayoutPut(
      putReq('x', { savedAt: 1 }),
      opts,
      'x',
    );
    expect(res.status).toBe(400);
  });

  test('400 — invalid JSON', async () => {
    const req = new Request('http://localhost/v1/showroom/layouts/x', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    const res = await handleShowroomLayoutPut(req, opts, 'x');
    expect(res.status).toBe(400);
  });

  test('400 — missing name', async () => {
    const res = await handleShowroomLayoutPut(putReq('x', { panels: [] }), opts, '');
    expect(res.status).toBe(400);
  });

  test('400 — name too long', async () => {
    const longName = 'a'.repeat(300);
    const res = await handleShowroomLayoutPut(putReq(longName, { panels: [] }), opts, longName);
    expect(res.status).toBe(400);
  });

  test('sanitizes invalid kind/state values', async () => {
    await handleShowroomLayoutPut(
      putReq('weird', {
        panels: [
          { id: 'p1', kind: 'malformed', provider: 'claude', state: 'invalid' },
        ],
      }),
      opts,
      'weird',
    );
    const res = handleShowroomLayoutGet(
      bareReq('http://localhost/v1/showroom/layouts/weird'),
      opts,
      'weird',
    );
    const body = (await res.json()) as {
      layout: { panels: Array<{ kind: string; state: string }> };
    };
    expect(body.layout.panels[0]!.kind).toBe('chat'); // default
    expect(body.layout.panels[0]!.state).toBe('live'); // default
  });

  test('rejects unknown agentBrand', async () => {
    await handleShowroomLayoutPut(
      putReq('odd', {
        panels: [
          { id: 'p1', kind: 'agent', provider: 'codex', agentBrand: 'fictional', state: 'live' },
        ],
      }),
      opts,
      'odd',
    );
    const res = handleShowroomLayoutGet(
      bareReq('http://localhost/v1/showroom/layouts/odd'),
      opts,
      'odd',
    );
    const body = (await res.json()) as {
      layout: { panels: Array<{ agentBrand?: string }> };
    };
    // Unknown brand silently dropped — kind stays `agent` but agentBrand 미존재.
    expect(body.layout.panels[0]!.agentBrand).toBeUndefined();
  });
});

describe('handleShowroomLayoutDelete', () => {
  test('200 — deletes', async () => {
    await handleShowroomLayoutPut(
      putReq('gone', { panels: [] }),
      opts,
      'gone',
    );
    const res = handleShowroomLayoutDelete(
      bareReq('http://localhost/v1/showroom/layouts/gone'),
      opts,
      'gone',
    );
    expect(res.status).toBe(200);
    const get = handleShowroomLayoutGet(
      bareReq('http://localhost/v1/showroom/layouts/gone'),
      opts,
      'gone',
    );
    expect(get.status).toBe(404);
  });

  test('404 — missing', async () => {
    const res = handleShowroomLayoutDelete(
      bareReq('http://localhost/v1/showroom/layouts/nope'),
      opts,
      'nope',
    );
    expect(res.status).toBe(404);
  });
});

describe('handleShowroomLayout — auth gate', () => {
  const optsWithToken: MetaApiOpts = { bearerToken: 'sec' };

  test('list 401 missing bearer', async () => {
    const res = handleShowroomLayoutsList(
      bareReq('http://localhost/v1/showroom/layouts'),
      optsWithToken,
    );
    expect(res.status).toBe(401);
  });

  test('put 401 missing bearer', async () => {
    const res = await handleShowroomLayoutPut(
      putReq('x', { panels: [] }),
      optsWithToken,
      'x',
    );
    expect(res.status).toBe(401);
  });

  test('200 with correct bearer', async () => {
    const req = new Request('http://localhost/v1/showroom/layouts', {
      headers: { authorization: 'Bearer sec' },
    });
    const res = handleShowroomLayoutsList(req, optsWithToken);
    expect(res.status).toBe(200);
  });
});

describe('R6 FU.3 (2026-05-09) — onShowroomLayoutsChange + SSE handler', () => {
  test('PUT emits upsert event with name + savedAt', async () => {
    const events: ShowroomLayoutsEvent[] = [];
    const off = onShowroomLayoutsChange((e) => events.push(e));
    try {
      await handleShowroomLayoutPut(putReq('alpha', { panels: [] }), opts, 'alpha');
      expect(events).toHaveLength(1);
      expect(events[0]?.kind).toBe('upsert');
      if (events[0]?.kind === 'upsert') {
        expect(events[0].name).toBe('alpha');
        expect(typeof events[0].savedAt).toBe('number');
      }
    } finally { off(); }
  });

  test('DELETE emits remove event', async () => {
    await handleShowroomLayoutPut(putReq('beta', { panels: [] }), opts, 'beta');
    const events: ShowroomLayoutsEvent[] = [];
    const off = onShowroomLayoutsChange((e) => events.push(e));
    try {
      handleShowroomLayoutDelete(
        new Request('http://localhost/v1/showroom/layouts/beta', { method: 'DELETE' }),
        opts,
        'beta',
      );
      expect(events).toHaveLength(1);
      expect(events[0]?.kind).toBe('remove');
      if (events[0]?.kind === 'remove') expect(events[0].name).toBe('beta');
    } finally { off(); }
  });

  test('listener unsubscribe removes from registry', () => {
    const baseline = _showroomLayoutsListenerCount();
    const off = onShowroomLayoutsChange(() => { /* noop */ });
    expect(_showroomLayoutsListenerCount()).toBe(baseline + 1);
    off();
    expect(_showroomLayoutsListenerCount()).toBe(baseline);
  });

  test('SSE handler returns text/event-stream + hello frame', async () => {
    await handleShowroomLayoutPut(putReq('a', { panels: [] }), opts, 'a');
    await handleShowroomLayoutPut(putReq('b', { panels: [] }), opts, 'b');
    const res = handleShowroomLayoutsEvents(
      new Request('http://localhost/v1/showroom/layouts/events'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('event: hello');
    expect(text).toContain('"count":2');
    void reader.cancel();
  });

  test('upsert event reaches an active SSE subscriber', async () => {
    const res = handleShowroomLayoutsEvents(
      new Request('http://localhost/v1/showroom/layouts/events'),
    );
    const reader = res.body!.getReader();
    await reader.read(); // drain hello
    await handleShowroomLayoutPut(putReq('gamma', { panels: [] }), opts, 'gamma');
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('event: upsert');
    expect(text).toContain('"name":"gamma"');
    void reader.cancel();
  });
});

describe('micro.1 (2026-05-09) — CORS coverage', () => {
  test('list response carries access-control-allow-origin', () => {
    const res = handleShowroomLayoutsList(bareReq('http://localhost/v1/showroom/layouts'), opts);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  test('PUT response carries CORS allow-origin', async () => {
    const res = await handleShowroomLayoutPut(
      putReq('cors-target', { panels: [] }),
      opts,
      'cors-target',
    );
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  test('DELETE response carries CORS allow-origin', async () => {
    await handleShowroomLayoutPut(putReq('to-delete', { panels: [] }), opts, 'to-delete');
    const res = handleShowroomLayoutDelete(
      new Request('http://localhost/v1/showroom/layouts/to-delete', { method: 'DELETE' }),
      opts,
      'to-delete',
    );
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  test('GET single layout carries CORS allow-origin', async () => {
    await handleShowroomLayoutPut(putReq('one', { panels: [] }), opts, 'one');
    const res = handleShowroomLayoutGet(
      new Request('http://localhost/v1/showroom/layouts/one'),
      opts,
      'one',
    );
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
