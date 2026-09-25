// FU-1 — coordinator extensions: handler-type key bindings, chord
// prefix + body matching, alias-list key spec. Covers the prerequisite
// surface area for porting the remaining dashboard hard branches
// (ssh-picker / finder-picker opener + pane-modal-chord) onto
// coordinator.registerKey.

import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { DisplayCoordinator } from '../src/display/index.js';
import { debug } from '../src/debug/log.js';
import type { KeyEvent } from '../src/display/types.js';

type KeyRouteLog = { category: string; event: string; data: Record<string, unknown> | undefined };

function captureKeyRouteLogs(): { logs: KeyRouteLog[]; restore: () => void } {
  const logs: KeyRouteLog[] = [];
  const spy = spyOn(debug, 'log').mockImplementation((category, event, data) => {
    logs.push({
      category,
      event,
      data: data as Record<string, unknown> | undefined,
    });
  });
  return { logs, restore: () => spy.mockRestore() };
}

function displayKeyLogs(logs: KeyRouteLog[]): KeyRouteLog[] {
  return logs.filter((entry) => entry.category === 'display.key');
}

function mkCoordinator(opts: { now?: () => number } = {}) {
  let fakeNow = 0;
  const nowFn = opts.now ?? (() => fakeNow);
  const c = new DisplayCoordinator({
    frameMs: 16,
    schedule: () => 0 as any,
    now: nowFn,
  });
  return {
    coordinator: c,
    advance(ms: number) { fakeNow += ms; },
    setNow(v: number) { fakeNow = v; },
  };
}

function key(name: string, mods: Partial<KeyEvent> = {}): KeyEvent {
  return { name, ctrl: false, shift: false, alt: false, ...mods };
}

describe('FU-1 handler-type binding', () => {
  test('registerKey with handler → routeKey returns {type:handler,invoke}', () => {
    const { coordinator } = mkCoordinator();
    let fired = 0;
    coordinator.registerKeyBinding({
      id: 'test:handler',
      key: 'C-k',
      scope: 'global',
      handler: () => { fired++; },
    });
    const r = coordinator.routeKey(key('k', { ctrl: true }));
    expect(r.type).toBe('handler');
    if (r.type === 'handler') {
      r.invoke();
      expect(fired).toBe(1);
    }
  });

  test('handler wins over command when both are set', () => {
    const { coordinator } = mkCoordinator();
    coordinator.registerKeyBinding({
      id: 'test:both',
      key: 'C-j',
      scope: 'global',
      command: '/should-be-ignored',
      handler: () => {},
    });
    const r = coordinator.routeKey(key('j', { ctrl: true }));
    expect(r.type).toBe('handler');
  });

  test('command-only binding still returns {type:command}', () => {
    const { coordinator } = mkCoordinator();
    coordinator.registerKeyBinding({
      id: 'test:cmd',
      key: 'C-l',
      scope: 'global',
      command: '/clear',
    });
    const r = coordinator.routeKey(key('l', { ctrl: true }));
    expect(r.type).toBe('command');
    if (r.type === 'command') {
      expect(r.command).toBe('/clear');
    }
  });
});

describe('Q4 (substrate Occam) — central key alias table', () => {
  test('binding declares latin only; jamo event resolves through table', () => {
    const { coordinator } = mkCoordinator();
    let fired = 0;
    coordinator.registerKeyBinding({
      id: 'test:alias',
      key: 'C-k', // Q4: no per-binding pipe alias; ㅏ resolves via central table
      scope: 'global',
      handler: () => { fired++; },
    });
    const r1 = coordinator.routeKey(key('k', { ctrl: true }));
    const r2 = coordinator.routeKey(key('ㅏ', { ctrl: true }));
    expect(r1.type).toBe('handler');
    expect(r2.type).toBe('handler');
  });

  test('alias with mismatched modifier still fails', () => {
    const { coordinator } = mkCoordinator();
    coordinator.registerKeyBinding({
      id: 'test:alias-mod',
      key: 'C-k',
      scope: 'global',
      handler: () => {},
    });
    // No ctrl → no match (alias resolution applies, modifier check is separate).
    expect(coordinator.routeKey(key('k')).type).toBe('passthrough');
    expect(coordinator.routeKey(key('ㅏ')).type).toBe('passthrough');
  });
});

describe('key binding registration diagnostics', () => {
  test('warns for unreachable Ctrl+Shift character chords without blocking registration', () => {
    const { coordinator } = mkCoordinator();
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const registration = coordinator.registerKeyBinding({
        id: 'test:unreachable',
        key: 'C-S-a',
        scope: 'global',
        handler: () => {},
      });
      expect(coordinator.snapshot().keyBindings.map(binding => binding.id)).toContain('test:unreachable');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('unreachable Ctrl+Shift character chord C-S-a'));
      registration.dispose();
    } finally {
      warn.mockRestore();
    }
  });

  test('warns with the first active registrant for normalized duplicate single and chord bindings', () => {
    const { coordinator } = mkCoordinator();
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const first = coordinator.registerKeyBinding({
        id: 'test:first-single',
        key: 'C-k',
        scope: 'global',
        handler: () => {},
      });
      const duplicate = coordinator.registerKeyBinding({
        id: 'test:duplicate-single',
        key: 'C-K',
        scope: 'global',
        handler: () => {},
      });
      coordinator.registerKeyBinding({
        id: 'test:first-chord',
        chordPrefix: 'C-m',
        key: 'S-p',
        scope: 'global',
        handler: () => {},
      });
      coordinator.registerKeyBinding({
        id: 'test:duplicate-chord',
        chordPrefix: 'C-M',
        key: 'S-P',
        scope: 'global',
        handler: () => {},
      });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('first registered by test:first-single'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('first registered by test:first-chord'));

      warn.mockClear();
      const firstAlias = coordinator.registerKeyBinding({
        id: 'test:first-alias',
        key: 'C-q',
        scope: 'global',
        handler: () => {},
      });
      const aliasDuplicate = coordinator.registerKeyBinding({
        id: 'test:duplicate-alias',
        key: 'C-ㅂ',
        scope: 'global',
        handler: () => {},
      });
      expect(coordinator.snapshot().keyBindings.map(binding => binding.id)).toContain('test:duplicate-alias');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('first registered by test:first-alias'));
      aliasDuplicate.dispose();
      firstAlias.dispose();

      warn.mockClear();
      coordinator.registerKeyBinding({
        id: 'test:first-single',
        key: 'C-k',
        scope: 'global',
        handler: () => {},
      });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('first registered by test:first-single'));

      coordinator.registerKeyBinding({
        id: 'test:registered-earlier-elsewhere',
        key: 'C-x',
        scope: 'global',
        handler: () => {},
      });
      coordinator.registerKeyBinding({
        id: 'test:current-first-registrant',
        key: 'C-j',
        scope: 'global',
        handler: () => {},
      });
      coordinator.registerKeyBinding({
        id: 'test:registered-earlier-elsewhere',
        key: 'C-j',
        scope: 'global',
        handler: () => {},
      });
      warn.mockClear();
      coordinator.registerKeyBinding({
        id: 'test:later-duplicate',
        key: 'C-j',
        scope: 'global',
        handler: () => {},
      });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('first registered by test:current-first-registrant'));

      first.dispose();
      duplicate.dispose();
      warn.mockClear();
      coordinator.registerKeyBinding({
        id: 'test:replacement-single',
        key: 'C-k',
        scope: 'global',
        handler: () => {},
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test('does not warn for a reachable unique binding', () => {
    const { coordinator } = mkCoordinator();
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      coordinator.registerKeyBinding({
        id: 'test:reachable-unique',
        key: 'C-g',
        scope: 'global',
        handler: () => {},
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('FU-1 chord binding', () => {
  test('prefix key arms, body fires handler', () => {
    const { coordinator } = mkCoordinator();
    let fired: string | null = null;
    coordinator.registerKeyBinding({
      id: 'test:chord-p',
      key: 'p',
      chordPrefix: 'C-m',
      scope: 'global',
      handler: () => { fired = 'preview'; },
    });
    const armed = coordinator.routeKey(key('m', { ctrl: true }));
    expect(armed.type).toBe('chord-armed');
    if (armed.type === 'chord-armed') expect(armed.prefix).toBe('C-m');

    const body = coordinator.routeKey(key('p'));
    expect(body.type).toBe('handler');
    if (body.type === 'handler') {
      body.invoke();
      expect(fired).toBe('preview');
    }
  });

  test('body mismatch disarms (second key not consumed as chord)', () => {
    const { coordinator } = mkCoordinator();
    coordinator.registerKeyBinding({
      id: 'test:chord-p',
      key: 'p',
      chordPrefix: 'C-m',
      scope: 'global',
      handler: () => {},
    });
    coordinator.routeKey(key('m', { ctrl: true })); // arm
    const miss = coordinator.routeKey(key('z'));
    expect(miss.type).toBe('passthrough');
    expect(coordinator._chordState()).toBeNull();
  });

  test('arm expires after chordTimeoutMs', () => {
    const h = mkCoordinator();
    h.coordinator.registerKeyBinding({
      id: 'test:chord-expire',
      key: 'p',
      chordPrefix: 'C-m',
      chordTimeoutMs: 100,
      scope: 'global',
      handler: () => {},
    });
    h.coordinator.routeKey(key('m', { ctrl: true })); // arm at t=0
    h.advance(200); // past timeout
    const r = h.coordinator.routeKey(key('p'));
    // Stale arm expired → body not matched as chord body; p falls through.
    expect(r.type).toBe('passthrough');
    expect(h.coordinator._chordState()).toBeNull();
  });

  test('multiple chord bindings under same prefix — correct body dispatches', () => {
    const { coordinator } = mkCoordinator();
    const fired: string[] = [];
    coordinator.registerKeyBinding({
      id: 'test:chord-p',
      key: 'p',
      chordPrefix: 'C-m',
      scope: 'global',
      handler: () => { fired.push('preview'); },
    });
    coordinator.registerKeyBinding({
      id: 'test:chord-l',
      key: 'l',
      chordPrefix: 'C-m',
      scope: 'global',
      handler: () => { fired.push('log'); },
    });
    coordinator.routeKey(key('m', { ctrl: true }));
    const r = coordinator.routeKey(key('l'));
    expect(r.type).toBe('handler');
    if (r.type === 'handler') r.invoke();
    expect(fired).toEqual(['log']);
  });

  test('chord prefix alias (Korean jamo) resolves through central table', () => {
    // Q4 (substrate Occam): bindings declare latin only; jamo event
    // input resolves through the KEY_ALIAS_TABLE so a binding declared
    // as `'C-m'` + `'p'` matches both Latin (Ctrl+m → p) and Korean
    // (Ctrl+ㅡ → ㅔ) input streams.
    const { coordinator } = mkCoordinator();
    let fired = 0;
    coordinator.registerKeyBinding({
      id: 'test:chord-alias',
      key: 'p',
      chordPrefix: 'C-m',
      scope: 'global',
      handler: () => { fired++; },
    });
    // Korean IME: Ctrl+ㅡ arms (resolves to Ctrl+m); ㅔ body fires
    // (resolves to p).
    coordinator.routeKey(key('ㅡ', { ctrl: true }));
    const r = coordinator.routeKey(key('ㅔ'));
    expect(r.type).toBe('handler');
    if (r.type === 'handler') r.invoke();
    expect(fired).toBe(1);
  });

  test('without any chord bindings, routeKey behaves as before', () => {
    const { coordinator } = mkCoordinator();
    coordinator.registerKeyBinding({
      id: 'test:regular',
      key: 'C-k',
      scope: 'global',
      handler: () => {},
    });
    const r = coordinator.routeKey(key('m', { ctrl: true }));
    // No chord binding registered; Ctrl+M → passthrough (not armed).
    expect(r.type).toBe('passthrough');
  });
});

describe('display.key route-decision logs', () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  test('unmatched key records no-match once with the key', () => {
    const capture = captureKeyRouteLogs();
    restore = capture.restore;
    const { coordinator } = mkCoordinator();
    coordinator.registerKeyBinding({
      id: 'test:other',
      key: 'C-k',
      scope: 'global',
      handler: () => {},
    });
    const r = coordinator.routeKey(key('p', { ctrl: true }));
    expect(r.type).toBe('passthrough');
    const decisions = displayKeyLogs(capture.logs);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toEqual({
      category: 'display.key',
      event: 'no-match',
      data: { key: 'C-p' },
    });
  });

  test('when-false records the blocked binding and never invokes the handler', () => {
    const capture = captureKeyRouteLogs();
    restore = capture.restore;
    const { coordinator } = mkCoordinator();
    let fired = 0;
    coordinator.registerKeyBinding({
      id: 'test:gated',
      key: 'C-p',
      scope: 'global',
      when: () => false,
      handler: () => { fired++; },
    });
    const r = coordinator.routeKey(key('p', { ctrl: true }));
    expect(r.type).toBe('passthrough');
    expect(fired).toBe(0);
    const decisions = displayKeyLogs(capture.logs);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toEqual({
      category: 'display.key',
      event: 'when-false',
      data: { key: 'C-p', id: 'test:gated' },
    });
  });

  test('out-of-scope when-false is no-match; in-scope when-false is the reason', () => {
    const capture = captureKeyRouteLogs();
    restore = capture.restore;
    const { coordinator } = mkCoordinator();
    let outOfScopeFired = 0;
    let inScopeFired = 0;
    coordinator.registerKeyBinding({
      id: 'test:out-of-scope-gated',
      key: 'C-p',
      scope: 'other-surface',
      when: () => false,
      handler: () => { outOfScopeFired++; },
    });
    const miss = coordinator.routeKey(key('p', { ctrl: true }));
    expect(miss.type).toBe('passthrough');
    expect(outOfScopeFired).toBe(0);
    expect(displayKeyLogs(capture.logs)).toEqual([{
      category: 'display.key',
      event: 'no-match',
      data: { key: 'C-p' },
    }]);

    capture.logs.length = 0;
    coordinator.registerKeyBinding({
      id: 'test:in-scope-gated',
      key: 'C-p',
      scope: 'global',
      when: () => false,
      handler: () => { inScopeFired++; },
    });
    const blocked = coordinator.routeKey(key('p', { ctrl: true }));
    expect(blocked.type).toBe('passthrough');
    expect(outOfScopeFired).toBe(0);
    expect(inScopeFired).toBe(0);
    expect(displayKeyLogs(capture.logs)).toEqual([{
      category: 'display.key',
      event: 'when-false',
      data: { key: 'C-p', id: 'test:in-scope-gated' },
    }]);
  });

  test('chord prefix records chord-armed and still swallows the prefix', () => {
    const capture = captureKeyRouteLogs();
    restore = capture.restore;
    const { coordinator } = mkCoordinator();
    coordinator.registerKeyBinding({
      id: 'test:chord-p',
      key: 'p',
      chordPrefix: 'C-m',
      scope: 'global',
      handler: () => {},
    });
    const armed = coordinator.routeKey(key('m', { ctrl: true }));
    expect(armed.type).toBe('chord-armed');
    if (armed.type === 'chord-armed') expect(armed.prefix).toBe('C-m');
    expect(coordinator._chordState()?.prefix).toBe('C-m');
    const decisions = displayKeyLogs(capture.logs);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toEqual({
      category: 'display.key',
      event: 'chord-armed',
      data: { key: 'C-m', id: 'test:chord-p', prefix: 'C-m' },
    });
  });

  test('selected binding records selected then handler invoke still fires', () => {
    const capture = captureKeyRouteLogs();
    restore = capture.restore;
    const { coordinator } = mkCoordinator();
    let fired = 0;
    coordinator.registerKeyBinding({
      id: 'test:open-finder',
      key: 'C-p',
      scope: 'global',
      handler: () => { fired++; },
    });
    const r = coordinator.routeKey(key('p', { ctrl: true }));
    expect(r.type).toBe('handler');
    if (r.type === 'handler') r.invoke();
    expect(fired).toBe(1);
    const decisions = displayKeyLogs(capture.logs);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toEqual({
      category: 'display.key',
      event: 'selected',
      data: { key: 'C-p', id: 'test:open-finder' },
    });
  });

  test('chord body match records selected and disarms', () => {
    const capture = captureKeyRouteLogs();
    restore = capture.restore;
    const { coordinator } = mkCoordinator();
    let fired = 0;
    coordinator.registerKeyBinding({
      id: 'test:chord-p',
      key: 'p',
      chordPrefix: 'C-m',
      scope: 'global',
      handler: () => { fired++; },
    });
    coordinator.routeKey(key('m', { ctrl: true }));
    capture.logs.length = 0;
    const body = coordinator.routeKey(key('p'));
    expect(body.type).toBe('handler');
    if (body.type === 'handler') body.invoke();
    expect(fired).toBe(1);
    expect(coordinator._chordState()).toBeNull();
    const decisions = displayKeyLogs(capture.logs);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toEqual({
      category: 'display.key',
      event: 'selected',
      data: { key: 'p', id: 'test:chord-p' },
    });
  });

  test('chord body mismatch still disarms without invoking', () => {
    const capture = captureKeyRouteLogs();
    restore = capture.restore;
    const { coordinator } = mkCoordinator();
    let fired = 0;
    coordinator.registerKeyBinding({
      id: 'test:chord-p',
      key: 'p',
      chordPrefix: 'C-m',
      scope: 'global',
      handler: () => { fired++; },
    });
    coordinator.routeKey(key('m', { ctrl: true }));
    capture.logs.length = 0;
    const miss = coordinator.routeKey(key('z'));
    expect(miss.type).toBe('passthrough');
    expect(fired).toBe(0);
    expect(coordinator._chordState()).toBeNull();
    const decisions = displayKeyLogs(capture.logs);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.event).toBe('no-match');
  });
});
