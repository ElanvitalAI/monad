// DS-4c — createLlmContextDropTarget contract tests (§8.1 of
// PLAN-drag-session-ds4c-llm-context.md).

import { describe, expect, test } from 'bun:test';
import {
  createLlmContextDropTarget,
  extractPaths,
} from '../src/llm-context-drop-target.js';
import { payload } from '../src/primitives/drag-session/index.js';
import type { DragSession } from '../src/primitives/drag-session/index.js';
import type { HitTarget } from '../src/input-core/event.js';
import type { SurfaceId } from '../src/display/types.js';

function makeSession(kinds: ReadonlyArray<readonly [string, unknown]>): DragSession {
  return {
    id: Symbol('test-session'),
    source: 'pane:browser' as SurfaceId,
    payload: payload(kinds, { label: 'x', icon: '📄' }),
    button: 'left',
    startedAt: 1000,
    startAt: { row: 10, col: 10 },
  };
}

const SURFACE = 'input::llm-context-drop' as SurfaceId;
const INPUT_ID = 'llm-context-drop';
const BOUNDS = { row: 20, col: 1, width: 80, height: 1 };

function target(onIngest?: (paths: readonly string[]) => void) {
  const calls: Array<readonly string[]> = [];
  const t = createLlmContextDropTarget({
    surfaceId: SURFACE,
    inputId: INPUT_ID,
    getBounds: () => BOUNDS,
    onIngestContext: (paths) => {
      calls.push(paths);
      onIngest?.(paths);
    },
  });
  return { target: t, calls };
}

const goodHit: HitTarget = { kind: 'input', inputId: INPUT_ID };

describe('createLlmContextDropTarget', () => {
  test('acceptKinds include llm-context-slice, file-path[], text/uri-list', () => {
    const { target: t } = target();
    expect(t.acceptKinds).toContain('llm-context-slice');
    expect(t.acceptKinds).toContain('file-path[]');
    expect(t.acceptKinds).toContain('text/uri-list');
  });

  test('surfaceId follows input:: convention', () => {
    const { target: t } = target();
    expect(String(t.surfaceId)).toBe('input::llm-context-drop');
  });

  test('onEnter returns optimistic accept with bounds + default hint', () => {
    const { target: t } = target();
    const session = makeSession([['llm-context-slice', { kind: 'files', paths: ['/a'] }]]);
    const fb = t.onEnter!(session);
    expect(fb.accept).toBe(true);
    expect(fb.action).toBe('copy');
    expect(fb.highlight).toEqual(BOUNDS);
    expect(fb.hint).toBe('Add to LLM context');
  });

  test('onEnter respects custom hint override', () => {
    const calls: Array<readonly string[]> = [];
    const t = createLlmContextDropTarget({
      surfaceId: SURFACE,
      inputId: INPUT_ID,
      getBounds: () => BOUNDS,
      hint: 'Attach as reference',
      onIngestContext: (p) => { calls.push(p); },
    });
    const session = makeSession([['file-path[]', ['/x']]]);
    const fb = t.onEnter!(session);
    expect(fb.hint).toBe('Attach as reference');
  });

  test('onOver matches hit → accept ; mismatch → refuse', () => {
    const { target: t } = target();
    const session = makeSession([['file-path[]', ['/x']]]);
    const accept = t.onOver!(session, goodHit);
    expect(accept.accept).toBe(true);
    const refuse1 = t.onOver!(session, { kind: 'input', inputId: 'chat-main' });
    expect(refuse1.accept).toBe(false);
    const refuse2 = t.onOver!(session, { kind: 'pane-body', paneId: 'browser' });
    expect(refuse2.accept).toBe(false);
  });

  test('onDrop · llm-context-slice primary · dropped + ingest called', () => {
    const { target: t, calls } = target();
    const session = makeSession([
      ['llm-context-slice', { kind: 'files', paths: ['/abs/a', '/abs/b'] }],
    ]);
    const outcome = t.onDrop(session, goodHit);
    expect(outcome.type).toBe('dropped');
    if (outcome.type === 'dropped') {
      expect(String(outcome.target)).toBe('input::llm-context-drop');
      expect(outcome.action).toBe('copy');
    }
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual(['/abs/a', '/abs/b']);
  });

  test('onDrop · file-path[] fallback when slice missing', () => {
    const { target: t, calls } = target();
    const session = makeSession([['file-path[]', ['/only-files']]]);
    const outcome = t.onDrop(session, goodHit);
    expect(outcome.type).toBe('dropped');
    expect(calls[0]).toEqual(['/only-files']);
  });

  test('onDrop · text/uri-list fallback with percent-decoding', () => {
    const { target: t, calls } = target();
    const uri = 'file:///tmp/hello%20world.txt\r\n# comment\r\nfile:///tmp/a.md\r\n';
    const session = makeSession([['text/uri-list', uri]]);
    const outcome = t.onDrop(session, goodHit);
    expect(outcome.type).toBe('dropped');
    expect(calls[0]).toEqual(['/tmp/hello world.txt', '/tmp/a.md']);
  });

  test('onDrop · malformed llm-context-slice falls back to file-path[]', () => {
    const { target: t, calls } = target();
    const session = makeSession([
      ['llm-context-slice', { kind: 'text', body: 'not files' }],
      ['file-path[]', ['/fallback']],
    ]);
    const outcome = t.onDrop(session, goodHit);
    expect(outcome.type).toBe('dropped');
    expect(calls[0]).toEqual(['/fallback']);
  });

  test('onDrop · wrong hit kind → rejected · no ingest call', () => {
    const { target: t, calls } = target();
    const session = makeSession([['file-path[]', ['/a']]]);
    const outcome = t.onDrop(session, { kind: 'pane-body', paneId: 'browser' });
    expect(outcome.type).toBe('rejected');
    if (outcome.type === 'rejected') {
      expect(outcome.reason).toContain('wrong-hit');
    }
    expect(calls.length).toBe(0);
  });

  test('onDrop · wrong inputId → rejected · no ingest call', () => {
    const { target: t, calls } = target();
    const session = makeSession([['file-path[]', ['/a']]]);
    const outcome = t.onDrop(session, { kind: 'input', inputId: 'chat-main' });
    expect(outcome.type).toBe('rejected');
    if (outcome.type === 'rejected') {
      expect(outcome.reason).toContain('wrong-hit:input:chat-main');
    }
    expect(calls.length).toBe(0);
  });

  test('onDrop · empty payload → rejected', () => {
    const { target: t, calls } = target();
    const session = makeSession([['llm-context-slice', { kind: 'files', paths: [] }]]);
    const outcome = t.onDrop(session, goodHit);
    expect(outcome.type).toBe('rejected');
    expect(calls.length).toBe(0);
  });

  test('onDrop · no accepted kinds in payload → rejected', () => {
    const { target: t, calls } = target();
    const session = makeSession([['text/plain', 'hi']]);
    const outcome = t.onDrop(session, goodHit);
    expect(outcome.type).toBe('rejected');
    expect(calls.length).toBe(0);
  });
});

describe('extractPaths priority', () => {
  test('llm-context-slice preferred over file-path[]', () => {
    const session = makeSession([
      ['llm-context-slice', { kind: 'files', paths: ['/slice'] }],
      ['file-path[]', ['/array']],
    ]);
    expect(extractPaths(session)).toEqual(['/slice']);
  });

  test('file-path[] preferred over uri-list when slice absent', () => {
    const session = makeSession([
      ['file-path[]', ['/array']],
      ['text/uri-list', 'file:///uri'],
    ]);
    expect(extractPaths(session)).toEqual(['/array']);
  });

  test('uri-list last-resort parses RFC 2483', () => {
    const session = makeSession([
      ['text/uri-list', 'file:///a\r\nfile:///b%20c'],
    ]);
    expect(extractPaths(session)).toEqual(['/a', '/b c']);
  });

  test('all empty → null', () => {
    const session = makeSession([['text/plain', 'nope']]);
    expect(extractPaths(session)).toBeNull();
  });
});
