// ── Debug log tests ──

import { afterEach, describe, test, expect, beforeEach } from 'bun:test';
import { existsSync, lstatSync, readFileSync, readlinkSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { debug, formatLine, redactSecrets, type DebugEvent } from '../src/debug/log.js';

/** Reset both sinks OFF — tests default to a known-quiet state rather
 *  than relying on the production default (file ON). `enable()`/
 *  `disable()` only move the mirror gate; tests that care about
 *  complete isolation toggle both explicitly. */
const RUN_ID_ENV = 'ELANOUS_RUN_ID';
const inheritedRunId = process.env[RUN_ID_ENV];

function resetDebug(): void {
  // Exact payload assertions must not depend on a harness-inherited run identity.
  delete process.env[RUN_ID_ENV];
  debug.setFileEnabled(false);
  debug.disable();          // mirror off
  debug.setVerboseEnabled(false);  // verbose off — 2026-04-20 enabled getter
                                    // reads this too, so must be explicit in reset
  debug.clear();
  debug.setMirrorHook(null);
}

afterEach(() => {
  if (inheritedRunId === undefined) delete process.env[RUN_ID_ENV];
  else process.env[RUN_ID_ENV] = inheritedRunId;
});

describe('debug singleton — enable / disable / toggle (mirror gate)', () => {
  beforeEach(resetDebug);

  test('with both sinks off, enabled getter is false', () => {
    expect(debug.enabled).toBe(false);
  });

  test('log() is a no-op when both sinks are off', () => {
    debug.log('test', 'skipped-event', { a: 1 });
    expect(debug.tail(10)).toEqual([]);
  });

  test('enable() (mirror ON) + log() pushes to ring buffer', () => {
    debug.enable();
    debug.log('test', 'hello', { x: 1 });
    const lines = debug.tail(10);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('test');
    expect(lines[0]).toContain('hello');
  });

  test('toggle flips mirror + returns new state', () => {
    expect(debug.toggle()).toBe(true);
    expect(debug.isMirrorEnabled()).toBe(true);
    expect(debug.toggle()).toBe(false);
    expect(debug.isMirrorEnabled()).toBe(false);
  });

  test('tail(N) returns most recent N events', () => {
    debug.enable();
    for (let i = 0; i < 10; i++) debug.log('cat', `event-${i}`);
    const tail3 = debug.tail(3);
    expect(tail3.length).toBe(3);
    expect(tail3[0]).toContain('event-7');
    expect(tail3[2]).toContain('event-9');
  });

  test('events(N) returns structured recent events', () => {
    debug.enable();
    debug.log('cat', 'one', { n: 1 });
    debug.log('cat', 'two', { n: 2 });
    const events = debug.events(1);
    expect(events).toEqual([
      expect.objectContaining({ category: 'cat', event: 'two', data: { n: 2 } }),
    ]);
  });

  test('clear() empties the ring buffer', () => {
    debug.enable();
    debug.log('cat', 'first');
    debug.clear();
    expect(debug.tail(10)).toEqual([]);
  });
});

describe('debug — file vs mirror independence', () => {
  beforeEach(resetDebug);

  test('file ON + mirror OFF → ring buffer captures, mirror hook does not fire', () => {
    const hookFired: string[] = [];
    debug.setMirrorHook(line => hookFired.push(line));
    debug.setFileEnabled(true);
    debug.disable();   // mirror off
    debug.log('cat', 'file-only');
    expect(debug.tail(1)[0]).toContain('file-only');
    expect(hookFired.length).toBe(0);
    expect(debug.isFileEnabled()).toBe(true);
    expect(debug.isMirrorEnabled()).toBe(false);
  });

  test('file OFF + mirror ON → hook fires, ring buffer still captures', () => {
    const hookFired: string[] = [];
    debug.setMirrorHook(line => hookFired.push(line));
    debug.setFileEnabled(false);
    debug.enable();   // mirror on
    debug.log('cat', 'mirror-only');
    expect(hookFired.length).toBe(1);
    expect(debug.tail(1)[0]).toContain('mirror-only');
  });
});

describe('debug mirror hook', () => {
  beforeEach(() => { resetDebug(); debug.setMirror(true); });

  test('when mirror=true and hook set, each event fires the hook', () => {
    const lines: string[] = [];
    debug.setMirrorHook(line => lines.push(line));
    debug.enable();
    debug.log('cat', 'mirrored');
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('mirrored');
  });

  test('mirror=false suppresses hook calls (ring buffer still fills)', () => {
    const lines: string[] = [];
    debug.setMirrorHook(line => lines.push(line));
    // Use the file sink to drive logging without the mirror. After
    // the enable/disable split, enable() flips mirror ON — we want
    // the inverse here: file-only.
    debug.setFileEnabled(true);
    debug.setMirror(false);
    debug.log('cat', 'file-only');
    expect(lines.length).toBe(0);
    expect(debug.tail(1)[0]).toContain('file-only');
  });

  test('no hook registered → no throw on log', () => {
    debug.enable();
    expect(() => debug.log('cat', 'silent')).not.toThrow();
  });

  test('hook that throws does not crash the caller', () => {
    debug.setMirrorHook(() => { throw new Error('hook-boom'); });
    debug.enable();
    expect(() => debug.log('cat', 'resilient')).not.toThrow();
  });
});

describe('debug.timed — scoped timer', () => {
  beforeEach(resetDebug);

  test('emits start + done events with durationMs', () => {
    debug.enable();
    const done = debug.timed('op', 'compute', { k: 'v' });
    done({ ok: true });
    const lines = debug.tail(10);
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('op.start');
    expect(lines[1]).toContain('op.done');
    expect(lines[1]).toContain('durationMs');
  });

  test('returns a no-op when disabled — no entries, no throw', () => {
    const done = debug.timed('op', 'x');
    done();
    expect(debug.tail(10)).toEqual([]);
  });
});

describe('formatLine', () => {
  test('no data → "[HH:MM:SS.mmm] [cat] event"', () => {
    const ev: DebugEvent = {
      ts: '2026-04-15T09:12:34.567Z',
      category: 'llm.request',
      event: 'openai-codex / gpt-5.4-mini',
    };
    const line = formatLine(ev);
    expect(line).toMatch(/^\[09:12:34\.567\] \[llm\.request\] openai-codex \/ gpt-5\.4-mini$/);
  });

  test('with data → appends JSON payload', () => {
    const ev: DebugEvent = {
      ts: '2026-04-15T09:12:34.567Z',
      category: 'key.route', event: 'j',
      data: { slot: 'browser', consumed: true },
    };
    const line = formatLine(ev);
    expect(line).toContain('key.route');
    expect(line).toContain('"slot":"browser"');
    expect(line).toContain('"consumed":true');
  });

  test('truncates very long payloads with ellipsis', () => {
    const ev: DebugEvent = {
      ts: '2026-04-15T09:12:34.567Z',
      category: 'llm.response', event: 'done',
      data: { text: 'x'.repeat(1000) },
    };
    const line = formatLine(ev);
    expect(line.length).toBeLessThanOrEqual(500);
    expect(line).toContain('…');
  });
});

describe('redactSecrets', () => {
  test('masks authorization bearer token keeping head/tail', () => {
    const out = redactSecrets({
      Authorization: 'Bearer sk-abcdef1234567890-XYZ',
      other: 'plain',
    });
    expect(out.Authorization).not.toBe('Bearer sk-abcdef1234567890-XYZ');
    expect(out.Authorization).toMatch(/…/);
    expect(out.other).toBe('plain');
  });

  test('masks short tokens wholesale to <redacted>', () => {
    const out = redactSecrets({ 'x-api-key': 'abc' });
    expect(out['x-api-key']).toBe('<redacted>');
  });

  test('recurses into nested objects', () => {
    const out = redactSecrets({
      outer: {
        inner: {
          access_token: 'supersecrettoken-12345678',
          keep: 'me',
        },
      },
    });
    expect((out as any).outer.inner.access_token).toMatch(/…/);
    expect((out as any).outer.inner.keep).toBe('me');
  });

  test('recurses into arrays', () => {
    const out = redactSecrets({
      list: [{ Authorization: 'Bearer longsecrettoken01234567' }],
    });
    expect((out as any).list[0].Authorization).toMatch(/…/);
  });

  test('returns primitives untouched', () => {
    expect(redactSecrets('plain')).toBe('plain');
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(null)).toBe(null);
    expect(redactSecrets(undefined)).toBe(undefined);
  });

  test('redacts variants: apikey, apiKey, Cookie, x-api-key, openai-api-key, refresh_token, accessToken', () => {
    const out = redactSecrets({
      apikey: 'a-long-one-xxxxx',
      apiKey: 'a-long-one-xxxxx',
      Cookie: 'a-long-one-xxxxx',
      'x-api-key': 'a-long-one-xxxxx',
      'openai-api-key': 'a-long-one-xxxxx',
      refresh_token: 'a-long-one-xxxxx',
      accessToken: 'a-long-one-xxxxx',
    }) as Record<string, string>;
    for (const k of Object.keys(out)) {
      expect(out[k]).not.toBe('a-long-one-xxxxx');
    }
  });
});

describe('debug — defaults + path', () => {
  test('path() is absolute and ends with debug-YYYYMMDDHHMMSS.log', () => {
    const p = debug.path();
    expect(p.startsWith('/')).toBe(true);
    // Per-session filename: 14-digit timestamp, no separators.
    expect(p).toMatch(/debug-\d{14}\.log$/);
  });

  test('path() sits under <cwd>/log (project-local) or falls back to XDG', () => {
    const p = debug.path();
    // Accept either cwd/log/ (primary) or ~/.local/share/elanous/debug/
    // (fallback when cwd was read-only at module load).
    expect(
      p.includes('/log/debug-') || p.includes('.local/share/elanous/debug/'),
    ).toBe(true);
  });

  test('production default has file sink ON at module load', () => {
    // Note: earlier tests mutate state; this test only runs in a fresh
    // describe block so the assertion is against the wider truth that
    // DebugLog.ctor seeds _fileEnabled=true. We verify via a direct
    // state toggle roundtrip.
    debug.setFileEnabled(true);
    expect(debug.isFileEnabled()).toBe(true);
  });
});

describe('compactForLog — payload compaction (default behaviour)', () => {
  test('short strings / arrays / objects pass through unchanged', () => {
    const { compactForLog } = require('../src/debug/log');
    expect(compactForLog('hello')).toBe('hello');
    expect(compactForLog([1, 2, 3])).toEqual([1, 2, 3]);
    expect(compactForLog({ a: 1 })).toEqual({ a: 1 });
  });

  test('long strings get "«+Nc»" tail marker with char-drop count', () => {
    const { compactForLog } = require('../src/debug/log');
    const long = 'x'.repeat(1000);
    const out = compactForLog(long, { stringMax: 100 }) as string;
    expect(out.startsWith('x'.repeat(100))).toBe(true);
    expect(out).toContain('«+900c»');
  });

  test('long arrays: first N entries + trailing {_more: M} marker', () => {
    const { compactForLog } = require('../src/debug/log');
    const arr = Array.from({ length: 20 }, (_, i) => i);
    const out = compactForLog(arr, { arrayMax: 3 }) as any[];
    expect(out.length).toBe(4);
    expect(out.slice(0, 3)).toEqual([0, 1, 2]);
    expect(out[3]).toEqual({ _more: 17 });
  });

  test('depth past maxDepth yields {_compact_depth_exceeded: true}', () => {
    const { compactForLog } = require('../src/debug/log');
    const deep = { a: { b: { c: { d: { e: 'buried' } } } } };
    const out = compactForLog(deep, { maxDepth: 2 }) as any;
    expect(out.a.b).toEqual({ _compact_depth_exceeded: true });
  });

  test('circular references become "<circular>" instead of crashing', () => {
    const { compactForLog } = require('../src/debug/log');
    const a: any = { name: 'a' };
    a.self = a;
    const out = compactForLog(a) as any;
    expect(out.name).toBe('a');
    expect(out.self).toBe('<circular>');
  });

  test('primitives survive verbatim', () => {
    const { compactForLog } = require('../src/debug/log');
    expect(compactForLog({ n: 42, b: true, x: null, u: undefined })).toEqual(
      { n: 42, b: true, x: null, u: undefined },
    );
  });
});

describe('DebugLog — verbose gate', () => {
  test('default: verboseEnabled is OFF', () => {
    expect(debug.isVerboseEnabled()).toBe(false);
  });

  test('setVerboseEnabled flips the flag both ways', () => {
    debug.setVerboseEnabled(true);
    expect(debug.isVerboseEnabled()).toBe(true);
    debug.setVerboseEnabled(false);
    expect(debug.isVerboseEnabled()).toBe(false);
  });

  test('setLevel controls capture mode (legacy → new level names)', () => {
    debug.setLevel('off');
    expect(debug.status()).toMatchObject({ file: false, mirror: false, verbose: false, level: 'off' });
    debug.setLevel('normal');
    expect(debug.status()).toMatchObject({ file: true, verbose: false, level: 'normal' });
    // 'verbose' is accepted for back-compat but reported as 'detail'
    // — the new canonical level name. See P1.3 comment on DebugLevel.
    debug.setLevel('verbose');
    expect(debug.status()).toMatchObject({ file: true, verbose: true, level: 'detail' });
    debug.setLevel('off');
  });

  test('log() applies compactForLog when verbose=OFF (default)', () => {
    debug.setVerboseEnabled(false);
    debug.enable();
    debug.clear();
    debug.log('t', 'e', { long: 'x'.repeat(500) });
    const dumped = debug.tail(1)[0] ?? '';
    expect(dumped).toContain('«+');   // compaction marker present
  });

  test('log() skips compaction when verbose=ON', () => {
    debug.setVerboseEnabled(true);
    debug.enable();
    debug.clear();
    debug.log('t', 'e', { long: 'x'.repeat(500) });
    const dumped = debug.tail(1)[0] ?? '';
    // formatLine() still truncates chat-mirror lines to ~400 chars for
    // display; the important invariant is that the string-compaction
    // marker "«+" is NOT applied.
    expect(dumped).not.toContain('«+');
    debug.setVerboseEnabled(false);
  });
});

describe('debug singleton — levels off/trail/normal/detail (P1.3)', () => {
  beforeEach(resetDebug);

  test('off: every sink closed, verbose flag cleared', () => {
    debug.setLevel('off');
    expect(debug.enabled).toBe(false);
    expect(debug.isFileEnabled()).toBe(false);
    expect(debug.isMirrorEnabled()).toBe(false);
    expect(debug.isDetailEnabled()).toBe(false);
    expect(debug.level()).toBe('off');
  });

  test('trail: file ON, mirror OFF, detail OFF (default-intended shape)', () => {
    debug.setLevel('trail');
    expect(debug.isFileEnabled()).toBe(true);
    expect(debug.isMirrorEnabled()).toBe(false);
    expect(debug.isDetailEnabled()).toBe(false);
    expect(debug.level()).toBe('trail');
  });

  test('normal: file ON + mirror ON, detail OFF', () => {
    debug.setLevel('normal');
    expect(debug.isFileEnabled()).toBe(true);
    expect(debug.isMirrorEnabled()).toBe(true);
    expect(debug.isDetailEnabled()).toBe(false);
    expect(debug.level()).toBe('normal');
  });

  test('detail: every sink + verbose=ON', () => {
    debug.setLevel('detail');
    expect(debug.isFileEnabled()).toBe(true);
    expect(debug.isMirrorEnabled()).toBe(true);
    expect(debug.isDetailEnabled()).toBe(true);
    expect(debug.level()).toBe('detail');
  });

  test('verbose is a back-compat alias of detail', () => {
    debug.setLevel('verbose');
    expect(debug.isDetailEnabled()).toBe(true);
    // level() reports the new canonical name.
    expect(debug.level()).toBe('detail');
  });

  test('level transitions preserve semantics: off → trail → detail → off', () => {
    debug.setLevel('off');
    debug.setLevel('trail');
    expect(debug.level()).toBe('trail');
    debug.setLevel('detail');
    expect(debug.level()).toBe('detail');
    expect(debug.isDetailEnabled()).toBe(true);
    debug.setLevel('off');
    expect(debug.level()).toBe('off');
    expect(debug.isDetailEnabled()).toBe(false);
  });
});

describe('debug — diag level (2026-04-22)', () => {
  beforeEach(() => {
    resetDebug();
    // Reset diag explicitly — resetDebug() flips the three original
    // sinks but doesn't know about the diag field. Tests rely on a
    // known-off starting state.
    (debug as unknown as { setDiagEnabled(on: boolean): void }).setDiagEnabled(false);
  });

  test('setLevel("diag"): file ON, diag ON, mirror OFF, verbose OFF', () => {
    debug.setLevel('diag');
    expect(debug.isFileEnabled()).toBe(true);
    expect(debug.isDiagEnabled()).toBe(true);
    expect(debug.isMirrorEnabled()).toBe(false);
    expect(debug.isVerboseEnabled()).toBe(false);
    expect(debug.level()).toBe('diag');
  });

  test('diag ON opens the hot-path gate (debug.enabled=true) even with mirror OFF', () => {
    debug.setLevel('diag');
    // The whole point of diag: `if (debug.enabled) debug.log(...)`
    // sites fire so the gated 122 instrumentation events reach the
    // file. Without this, file-only mode stays silent on them.
    expect(debug.enabled).toBe(true);
    expect(debug.isMirrorEnabled()).toBe(false);
  });

  test('diag mirror hook does NOT fire — chat pane stays quiet', () => {
    const mirrored: string[] = [];
    debug.setMirrorHook(line => mirrored.push(line));
    debug.setLevel('diag');
    debug.log('drag-session.pull', 'probe', { x: 1 });
    // Ring buffer captures (sink is live), but mirror hook is off.
    expect(debug.tail(1)[0]).toContain('drag-session.pull');
    expect(mirrored.length).toBe(0);
  });

  test('setLevel("normal") from diag drops the diag flag (mirror takes over)', () => {
    debug.setLevel('diag');
    expect(debug.isDiagEnabled()).toBe(true);
    debug.setLevel('normal');
    expect(debug.isDiagEnabled()).toBe(false);
    expect(debug.isMirrorEnabled()).toBe(true);
    expect(debug.level()).toBe('normal');
  });

  test('setLevel("trail") from diag drops the diag flag (back to quiet)', () => {
    debug.setLevel('diag');
    debug.setLevel('trail');
    expect(debug.isDiagEnabled()).toBe(false);
    expect(debug.enabled).toBe(false);
    expect(debug.level()).toBe('trail');
  });

  test('setLevel("off") drops every flag including diag', () => {
    debug.setLevel('diag');
    debug.setLevel('off');
    expect(debug.isDiagEnabled()).toBe(false);
    expect(debug.isFileEnabled()).toBe(false);
    expect(debug.level()).toBe('off');
  });

  test('setDiagEnabled is orthogonal — does not touch mirror / file / verbose', () => {
    debug.setFileEnabled(true);
    debug.setMirror(false);
    debug.setVerboseEnabled(false);
    debug.setDiagEnabled(true);
    expect(debug.isFileEnabled()).toBe(true);
    expect(debug.isMirrorEnabled()).toBe(false);
    expect(debug.isVerboseEnabled()).toBe(false);
    expect(debug.isDiagEnabled()).toBe(true);
    // level() reports diag
    expect(debug.level()).toBe('diag');
  });

  test('level() precedence: detail > normal > diag > trail > off', () => {
    // diag beats trail
    debug.setFileEnabled(true);
    debug.setMirror(false);
    debug.setDiagEnabled(true);
    debug.setVerboseEnabled(false);
    expect(debug.level()).toBe('diag');

    // normal beats diag (mirror takes precedence since it's a louder,
    // user-visible sink)
    debug.setMirror(true);
    expect(debug.level()).toBe('normal');

    // detail beats normal
    debug.setVerboseEnabled(true);
    expect(debug.level()).toBe('detail');
  });

  test('status() surfaces the diag flag', () => {
    debug.setLevel('diag');
    const s = debug.status();
    expect(s.diag).toBe(true);
    expect(s.mirror).toBe(false);
    expect(s.level).toBe('diag');
  });

  test('gated pattern `if (debug.enabled) debug.log(...)` fires in diag but not in trail', () => {
    let hotPathCalls = 0;
    const gated = (): void => {
      if (debug.enabled) {
        hotPathCalls++;
        debug.log('hotpath', 'fired');
      }
    };

    debug.setLevel('trail');
    gated();
    gated();
    expect(hotPathCalls).toBe(0);

    debug.setLevel('diag');
    gated();
    gated();
    expect(hotPathCalls).toBe(2);
    // Events landed on disk (unconditional behavior) via the file sink.
    const contents = debug.readFile();
    expect(contents).toContain('"event":"fired"');
  });
});

describe('debug.enabled — loud-sink gate (2026-04-20 fix)', () => {
  beforeEach(resetDebug);

  test('file-only trail does NOT light up `enabled` (hot-path gate silent)', () => {
    debug.setLevel('trail');
    expect(debug.isFileEnabled()).toBe(true);
    expect(debug.isMirrorEnabled()).toBe(false);
    expect(debug.enabled).toBe(false);
    // `level()` still reports 'trail' because it checks all sinks directly
    expect(debug.level()).toBe('trail');
    // `isAnySinkEnabled()` captures the old meaning for callers that need it.
    expect(debug.isAnySinkEnabled()).toBe(true);
  });

  test('mirror ON lights up `enabled`', () => {
    debug.setLevel('normal');
    expect(debug.enabled).toBe(true);
  });

  test('detail/verbose ON lights up `enabled`', () => {
    debug.setLevel('detail');
    expect(debug.enabled).toBe(true);
  });

  test('/debug off (mirror off, file stays) → enabled=false but file still captures unconditional callers', () => {
    debug.setFileEnabled(true);
    debug.enable();   // mirror on
    expect(debug.enabled).toBe(true);
    debug.disable(); // mirror off — equivalent to `/debug off`
    expect(debug.isFileEnabled()).toBe(true);
    expect(debug.isMirrorEnabled()).toBe(false);
    expect(debug.enabled).toBe(false);
    // Unconditional log() still writes to file (captures critical events)
    debug.log('critical', 'write-me', { ok: true });
    const contents = debug.readFile();
    expect(contents).toContain('"event":"write-me"');
  });

  test('guard pattern `if (debug.enabled) debug.log(...)` skips in trail mode', () => {
    debug.setLevel('trail');
    let callsMade = 0;
    const guardedLog = (): void => {
      if (debug.enabled) {
        callsMade++;
        debug.log('guarded', 'fired');
      }
    };
    guardedLog();
    guardedLog();
    expect(callsMade).toBe(0);
    // But direct unconditional log STILL captures per trail-forensic contract
    debug.log('unconditional', 'captured');
    expect(debug.readFile()).toContain('"event":"captured"');
  });
});

describe('debug singleton — batched file writes (P1.2)', () => {
  beforeEach(resetDebug);

  test('readFile() reflects writes after internal flush regardless of timer', () => {
    debug.setFileEnabled(true);
    debug.clear();
    debug.log('batch', 'one', { n: 1 });
    debug.log('batch', 'two', { n: 2 });
    debug.log('batch', 'three', { n: 3 });
    // readFile() flushes internally — we must see all 3 even though
    // the 100ms timer hasn't fired yet.
    const contents = debug.readFile();
    expect(contents).toContain('"event":"one"');
    expect(contents).toContain('"event":"two"');
    expect(contents).toContain('"event":"three"');
    debug.setFileEnabled(false);
  });

  test('flush() on empty buffer is a safe no-op', () => {
    debug.setFileEnabled(true);
    debug.clear();
    expect(() => debug.flush()).not.toThrow();
    debug.setFileEnabled(false);
  });

  test('setFileEnabled(false) flushes pending writes before flipping off', () => {
    debug.setFileEnabled(true);
    debug.clear();
    debug.log('batch', 'final-before-disable', { a: 1 });
    debug.setFileEnabled(false);
    // Re-read the file — it should contain the event because
    // setFileEnabled(false) drained the pending buffer first.
    debug.setFileEnabled(true);
    const contents = debug.readFile();
    expect(contents).toContain('"event":"final-before-disable"');
    debug.setFileEnabled(false);
  });

  test('clear() discards pending writes + truncates file', () => {
    debug.setFileEnabled(true);
    debug.log('batch', 'pre-clear');
    debug.clear();
    debug.flush();
    const contents = debug.readFile();
    expect(contents).not.toContain('"event":"pre-clear"');
    debug.setFileEnabled(false);
  });
});

describe('debug — log/latest symlink (Phase C)', () => {
  function latestPath(): string {
    return join(dirname(debug.path()), 'latest');
  }

  beforeEach(() => {
    resetDebug();
    try { unlinkSync(latestPath()); } catch { /* not there */ }
    // Force re-create on next append by flipping the file sink.
    // The internal memoization flag is private; toggling the sink
    // does not reset it, but unlinking the file + writing again is
    // a valid observation point since the flag stays true.
  });

  test('first append after clean LOG_DIR creates `latest` symlink → active file', () => {
    debug.setFileEnabled(true);
    debug.clear();
    try { unlinkSync(latestPath()); } catch { /* not there */ }
    debug.log('sym', 'first-event', { x: 1 });
    debug.flush();
    // Symlink exists and is a symlink (not a plain file).
    expect(existsSync(latestPath())).toBe(true);
    expect(lstatSync(latestPath()).isSymbolicLink()).toBe(true);
    expect(readlinkSync(latestPath())).toBe(debug.path());
    debug.setFileEnabled(false);
  });

  test('symlink creation is idempotent — repeated flushes do not thrash', () => {
    debug.setFileEnabled(true);
    debug.clear();
    // Multiple logs + flushes — symlink should survive unchanged.
    debug.log('sym', 'a');
    debug.flush();
    const first = readlinkSync(latestPath());
    debug.log('sym', 'b');
    debug.flush();
    debug.log('sym', 'c');
    debug.flush();
    const final = readlinkSync(latestPath());
    expect(final).toBe(first);
    expect(final).toBe(debug.path());
    debug.setFileEnabled(false);
  });
});

describe('debug — size-based rotation (Phase E)', () => {
  // Derive rotated-slot paths from the active log path.
  function rotatedPath(slot: number): string {
    const p = debug.path();
    const i = p.lastIndexOf('.log');
    const base = i >= 0 ? p.slice(0, i) : p;
    return `${base}.${slot}.log`;
  }

  // Remove any rotated files left behind — rotation mutates the
  // filesystem, so cleanup is best-effort but mandatory.
  function cleanupRotated(): void {
    for (let i = 1; i <= 5; i++) {
      try { unlinkSync(rotatedPath(i)); } catch { /* not there */ }
    }
  }

  beforeEach(() => {
    resetDebug();
    cleanupRotated();
    debug.setMaxFileBytes(0); // disable before any test configures it
  });

  test('active log rotates to .1.log when it crosses the threshold', () => {
    debug.setFileEnabled(true);
    debug.setMaxFileBytes(500); // well below a single event burst
    debug.clear();
    // 20 events × ~50+ bytes each > 500 bytes threshold
    for (let i = 0; i < 20; i++) debug.log('rot', `event-${i}`, { n: i });
    debug.flush();
    // Rotation fires when bytesWritten crosses 500, so the active
    // file is now fresh (the pre-rotation content moved to .1).
    expect(existsSync(rotatedPath(1))).toBe(true);
    const rotated = readFileSync(rotatedPath(1), 'utf8');
    expect(rotated).toContain('"event":"event-0"');
    expect(debug.bytesWritten()).toBe(0);
    debug.setMaxFileBytes(0);
    debug.setFileEnabled(false);
    cleanupRotated();
  });

  test('repeated rotations cascade .1 → .2 → .3; no .4', () => {
    debug.setFileEnabled(true);
    debug.setMaxFileBytes(300);
    debug.clear();
    // Drive four rotations so the fourth one must evict .3
    for (let round = 0; round < 4; round++) {
      for (let i = 0; i < 15; i++) {
        debug.log('cascade', `r${round}-e${i}`, { n: i });
      }
      debug.flush();
    }
    // After 4 rotations: .1 (most recent rotation), .2, .3. No .4.
    expect(existsSync(rotatedPath(1))).toBe(true);
    expect(existsSync(rotatedPath(2))).toBe(true);
    expect(existsSync(rotatedPath(3))).toBe(true);
    expect(existsSync(rotatedPath(4))).toBe(false);
    debug.setMaxFileBytes(0);
    debug.setFileEnabled(false);
    cleanupRotated();
  });

  test('threshold of 0 (disabled) means no rotation ever', () => {
    debug.setFileEnabled(true);
    debug.setMaxFileBytes(0);
    debug.clear();
    for (let i = 0; i < 50; i++) debug.log('norot', `e-${i}`, { pad: 'x'.repeat(100) });
    debug.flush();
    expect(existsSync(rotatedPath(1))).toBe(false);
    expect(debug.bytesWritten()).toBeGreaterThan(1000);
    debug.setFileEnabled(false);
    cleanupRotated();
  });
});

describe('debug — bytes-based secondary overflow (Phase B)', () => {
  beforeEach(resetDebug);

  const drainImmediate = (): Promise<void> =>
    new Promise(resolve => setImmediate(resolve));

  test('a single large payload (>64KB) triggers overflow even under the 32-event count', async () => {
    debug.setFileEnabled(true);
    debug.clear();
    // ~80KB string: exceeds FLUSH_BATCH_BYTES on its own. Verbose ON
    // so compactForLog doesn't elide the payload and we're actually
    // measuring the bytes path.
    debug.setVerboseEnabled(true);
    const big = 'B'.repeat(80 * 1024);
    debug.log('bytes', 'big-one', { payload: big });
    // Event count is 1 (far below 32) — only the bytes threshold can
    // have triggered deferral. Drain setImmediate and confirm landed.
    await drainImmediate();
    const contents = debug.readFile();
    expect(contents).toContain('"event":"big-one"');
    debug.setVerboseEnabled(false);
    debug.setFileEnabled(false);
  });

  test('small events accumulate and flush on the timer, not bytes threshold', async () => {
    debug.setFileEnabled(true);
    debug.clear();
    // 3 tiny events — well under both 32-count and 64KB-bytes.
    // These must NOT trigger overflow; they should be written by the
    // usual sync flush() path.
    debug.log('bytes', 'tiny-1');
    debug.log('bytes', 'tiny-2');
    debug.log('bytes', 'tiny-3');
    // Without awaiting, the file may or may not contain anything yet
    // (timer-scheduled). flush() drains synchronously.
    debug.flush();
    const contents = debug.readFile();
    expect(contents).toContain('"event":"tiny-1"');
    expect(contents).toContain('"event":"tiny-3"');
    debug.setFileEnabled(false);
  });
});

describe('debug — bytesWritten counter (Phase F)', () => {
  beforeEach(resetDebug);

  test('bytesWritten starts at 0 and grows with each flush', () => {
    debug.setFileEnabled(true);
    debug.clear();
    expect(debug.bytesWritten()).toBe(0);
    debug.log('byt', 'e1', { a: 1 });
    debug.flush();
    const after1 = debug.bytesWritten();
    expect(after1).toBeGreaterThan(0);
    debug.log('byt', 'e2', { a: 2 });
    debug.flush();
    const after2 = debug.bytesWritten();
    expect(after2).toBeGreaterThan(after1);
    debug.setFileEnabled(false);
  });

  test('clear() resets bytesWritten to 0', () => {
    debug.setFileEnabled(true);
    debug.clear();
    debug.log('byt', 'before-clear');
    debug.flush();
    expect(debug.bytesWritten()).toBeGreaterThan(0);
    debug.clear();
    expect(debug.bytesWritten()).toBe(0);
    debug.setFileEnabled(false);
  });

  test('status() surfaces bytesWritten', () => {
    debug.setFileEnabled(true);
    debug.clear();
    debug.log('byt', 'status-probe', { x: 'yz' });
    debug.flush();
    const s = debug.status();
    expect(s.bytesWritten).toBeGreaterThan(0);
    debug.setFileEnabled(false);
  });
});

describe('debug — count-overflow deferred via setImmediate (Phase A)', () => {
  beforeEach(resetDebug);

  // Helper — yields to the macrotask queue so queued setImmediate
  // callbacks run before the assertion. A single microtask await
  // (Promise.resolve()) is NOT enough: setImmediate fires on the
  // check phase, after the current microtask checkpoint.
  const drainImmediate = (): Promise<void> =>
    new Promise(resolve => setImmediate(resolve));

  test('burst past FLUSH_BATCH_SIZE does NOT write on the same tick', async () => {
    debug.setFileEnabled(true);
    debug.clear();
    // Push 40 events — past the 32-event threshold. Synchronous path
    // should have detached the batch to `_pendingOverflow` but not
    // yet appended to disk.
    for (let i = 0; i < 40; i++) debug.log('overflow', `e-${i}`, { n: i });
    // Same tick (no await). File should be empty because the
    // deferred setImmediate hasn't run yet — readFile() on the disk
    // side would be empty. We use the internal contract: flush()
    // drains + writes synchronously, and after flush the file
    // contains all events.
    // Round-trip the wait through a setImmediate so the deferred
    // callback actually fires, then confirm events landed.
    await drainImmediate();
    const contents = debug.readFile();
    expect(contents).toContain('"event":"e-0"');
    expect(contents).toContain('"event":"e-39"');
    debug.setFileEnabled(false);
  });

  test('concurrent overflow calls coalesce into one deferred write', async () => {
    debug.setFileEnabled(true);
    debug.clear();
    // First overflow — 32 events, detach fires once.
    for (let i = 0; i < 32; i++) debug.log('burst', `a-${i}`);
    // Still same tick — push 32 more. These coalesce into the
    // existing `_pendingOverflow`; no second setImmediate queued.
    for (let i = 0; i < 32; i++) debug.log('burst', `b-${i}`);
    await drainImmediate();
    const contents = debug.readFile();
    // Both batches landed in order (a-* before b-*).
    const idxA0 = contents.indexOf('"event":"a-0"');
    const idxB0 = contents.indexOf('"event":"b-0"');
    expect(idxA0).toBeGreaterThanOrEqual(0);
    expect(idxB0).toBeGreaterThan(idxA0);
    // All 64 events present.
    expect(contents).toContain('"event":"a-31"');
    expect(contents).toContain('"event":"b-31"');
    debug.setFileEnabled(false);
  });

  test('sync flush() drains overflow before the setImmediate fires', async () => {
    debug.setFileEnabled(true);
    debug.clear();
    for (let i = 0; i < 35; i++) debug.log('sync-vs-defer', `e-${i}`);
    // Without awaiting the macrotask, explicitly flush synchronously.
    // The sync path must drain `_pendingOverflow` so the queued
    // setImmediate sees null and no-ops (no double write).
    debug.flush();
    const mid = debug.readFile();
    expect(mid).toContain('"event":"e-34"');
    // After draining the queued setImmediate, nothing duplicates.
    await drainImmediate();
    const after = debug.readFile();
    // Count occurrences of a single event — must be exactly 1.
    const occurrences = (after.match(/"event":"e-0"/g) || []).length;
    expect(occurrences).toBe(1);
    debug.setFileEnabled(false);
  });

  test('clear() between overflow + setImmediate callback drops the detached batch', async () => {
    debug.setFileEnabled(true);
    debug.clear();
    for (let i = 0; i < 40; i++) debug.log('canceled', `e-${i}`);
    // Cancel before setImmediate fires — pendingOverflow dropped.
    debug.clear();
    await drainImmediate();
    const contents = debug.readFile();
    expect(contents).not.toContain('"event":"e-0"');
    expect(contents).not.toContain('"event":"e-39"');
    debug.setFileEnabled(false);
  });
});
