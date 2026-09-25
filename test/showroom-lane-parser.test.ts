// Showroom v2 · Lane token parser tests.
//
// Covers PLAN §D2 grammar:
//   - role:provider · provider · role:provider:transport · provider:transport
//   - lll:<model>[:transport]
//   - auto · auto:role (legacy compat)
//   - --focus tail
//   - error paths

import { describe, test, expect } from 'bun:test';
import { parseLaneTokens } from '../src/showroom/lane-parser.js';

describe('parseLaneTokens · empty + happy paths', () => {
  test('no tokens → empty lanes', () => {
    expect(parseLaneTokens([])).toEqual({ lanes: [] });
  });

  test('plain provider → brandRef only', () => {
    const r = parseLaneTokens(['claude']);
    expect(r.error).toBeUndefined();
    expect(r.lanes).toEqual([{ brandRef: 'claude' }]);
  });

  test('role:provider → role + brandRef', () => {
    const r = parseLaneTokens(['plan:claude']);
    expect(r.error).toBeUndefined();
    expect(r.lanes).toEqual([{ role: 'plan', brandRef: 'claude' }]);
  });

  test('role:provider:transport → all 3 fields', () => {
    const r = parseLaneTokens(['build:codex:acp']);
    expect(r.error).toBeUndefined();
    expect(r.lanes).toEqual([
      { role: 'build', brandRef: 'codex', transportPref: 'acp' },
    ]);
  });

  test('provider:transport → brandRef + transportPref (no role)', () => {
    const r = parseLaneTokens(['gemini:pty']);
    expect(r.error).toBeUndefined();
    expect(r.lanes).toEqual([{ brandRef: 'gemini', transportPref: 'pty' }]);
  });

  test('three lanes mixed', () => {
    const r = parseLaneTokens(['plan:claude', 'build:codex', 'review:gemini']);
    expect(r.error).toBeUndefined();
    expect(r.lanes).toEqual([
      { role: 'plan', brandRef: 'claude' },
      { role: 'build', brandRef: 'codex' },
      { role: 'review', brandRef: 'gemini' },
    ]);
  });
});

describe('parseLaneTokens · lll local-llm', () => {
  test('lll:<model> as plain provider', () => {
    const r = parseLaneTokens(['lll:llama3']);
    expect(r.error).toBeUndefined();
    expect(r.lanes).toEqual([{ brandRef: 'lll:llama3' }]);
  });

  test('role:lll:<model>', () => {
    const r = parseLaneTokens(['build:lll:llama3']);
    expect(r.error).toBeUndefined();
    expect(r.lanes).toEqual([{ role: 'build', brandRef: 'lll:llama3' }]);
  });

  test('role:lll:<model>:transport', () => {
    const r = parseLaneTokens(['build:lll:llama3:pty']);
    expect(r.error).toBeUndefined();
    expect(r.lanes).toEqual([
      { role: 'build', brandRef: 'lll:llama3', transportPref: 'pty' },
    ]);
  });

  test('lll:<model>:transport (no role)', () => {
    const r = parseLaneTokens(['lll:llama3:auto']);
    expect(r.error).toBeUndefined();
    expect(r.lanes).toEqual([
      { brandRef: 'lll:llama3', transportPref: 'auto' },
    ]);
  });

  test('lll without model → error', () => {
    const r = parseLaneTokens(['lll']);
    // 'lll' has no colon, so it's treated as plain brandRef. brand-resolver
    // will reject downstream; parser stays lax.
    expect(r.error).toBeUndefined();
    expect(r.lanes).toEqual([{ brandRef: 'lll' }]);
  });

  test('lll: (empty model) → error', () => {
    const r = parseLaneTokens(['lll:']);
    expect(r.error).toMatch(/empty local-llm model/);
  });
});

describe('parseLaneTokens · auto legacy compat', () => {
  test('auto alone', () => {
    const r = parseLaneTokens(['auto']);
    expect(r.error).toBeUndefined();
    expect(r.lanes).toEqual([{ brandRef: 'auto' }]);
  });

  test('auto:plan → brandRef=auto + role=plan', () => {
    const r = parseLaneTokens(['auto:plan']);
    expect(r.error).toBeUndefined();
    expect(r.lanes).toEqual([{ brandRef: 'auto', role: 'plan' }]);
  });

  test('auto:exec', () => {
    const r = parseLaneTokens(['auto:exec']);
    expect(r.lanes).toEqual([{ brandRef: 'auto', role: 'exec' }]);
  });

  test('auto:bogus → error', () => {
    const r = parseLaneTokens(['auto:bogus']);
    expect(r.error).toMatch(/role must be one of/);
  });
});

describe('parseLaneTokens · --focus tail', () => {
  test('focus after 2 lanes', () => {
    const r = parseLaneTokens(['claude', 'codex', '--focus', '1']);
    expect(r.error).toBeUndefined();
    expect(r.lanes.length).toBe(2);
    expect(r.focusIndex).toBe(1);
  });

  test('focus after 3 lanes with roles', () => {
    const r = parseLaneTokens([
      'plan:claude', 'build:codex', 'review:gemini', '--focus', '0',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.lanes.length).toBe(3);
    expect(r.focusIndex).toBe(0);
  });

  test('focus alone (just --focus 0) → 0 lanes + focusIndex set', () => {
    const r = parseLaneTokens(['--focus', '0']);
    expect(r.error).toBeUndefined();
    expect(r.lanes.length).toBe(0);
    expect(r.focusIndex).toBe(0);
  });

  test('focus with non-integer → error', () => {
    const r = parseLaneTokens(['claude', 'codex', '--focus', 'abc']);
    expect(r.error).toMatch(/integer/);
  });

  test('focus mid-stream → error (must be at end)', () => {
    const r = parseLaneTokens(['claude', '--focus', '0', 'codex']);
    expect(r.error).toMatch(/use `--focus <idx>` once at the end/);
  });
});

describe('parseLaneTokens · error paths', () => {
  test('invalid transport', () => {
    const r = parseLaneTokens(['claude:bogus']);
    expect(r.error).toMatch(/transport must be pty\|acp\|auto/);
  });

  test('role with no provider', () => {
    const r = parseLaneTokens(['plan:']);
    // 'plan:' splits to ['plan',''] · provider tail empty
    expect(r.error).toMatch(/empty provider|empty/);
  });

  test('empty token', () => {
    const r = parseLaneTokens(['', 'claude']);
    expect(r.error).toMatch(/lane\[0\] is empty/);
  });

  test('whitespace token', () => {
    const r = parseLaneTokens(['   ']);
    expect(r.error).toMatch(/empty/);
  });
});

describe('parseLaneTokens · alias passthrough (brand-resolver handles)', () => {
  test('cas alias kept verbatim', () => {
    const r = parseLaneTokens(['plan:cas']);
    expect(r.lanes).toEqual([{ role: 'plan', brandRef: 'cas' }]);
  });

  test('clc alias kept verbatim', () => {
    const r = parseLaneTokens(['build:clc:pty']);
    expect(r.lanes).toEqual([
      { role: 'build', brandRef: 'clc', transportPref: 'pty' },
    ]);
  });
});

describe('parseLaneTokens · --auto-relay flag (Arc 4)', () => {
  test('--auto-relay alone → empty lanes + autoRelay set', () => {
    const r = parseLaneTokens(['--auto-relay']);
    expect(r.error).toBeUndefined();
    expect(r.lanes.length).toBe(0);
    expect(r.autoRelay).toBe(true);
  });

  test('lanes + --auto-relay at end', () => {
    const r = parseLaneTokens(['claude', 'codex', '--auto-relay']);
    expect(r.error).toBeUndefined();
    expect(r.lanes.length).toBe(2);
    expect(r.autoRelay).toBe(true);
  });

  test('--auto-relay anywhere · stripped before lane parsing', () => {
    const r = parseLaneTokens(['claude', '--auto-relay', 'codex']);
    expect(r.error).toBeUndefined();
    expect(r.lanes.length).toBe(2);
    expect(r.autoRelay).toBe(true);
  });

  test('--auto-relay with --focus combo', () => {
    const r = parseLaneTokens([
      'plan:claude', 'build:codex', '--auto-relay', '--focus', '1',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.lanes.length).toBe(2);
    expect(r.focusIndex).toBe(1);
    expect(r.autoRelay).toBe(true);
  });

  test('no --auto-relay → autoRelay undefined', () => {
    const r = parseLaneTokens(['claude', 'codex']);
    expect(r.autoRelay).toBeUndefined();
  });
});

describe('parseLaneTokens · --surface (Sprint 21 M1.1)', () => {
  test('lanes + --surface discord:<channelId>', () => {
    const r = parseLaneTokens([
      'plan:claude', 'build:codex', '--surface', 'discord:1234567890',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.lanes.length).toBe(2);
    expect(r.surfacePref).toEqual({ kind: 'discord', channelId: '1234567890' });
  });

  test('--surface stripped before lane parsing · can appear anywhere', () => {
    const r = parseLaneTokens([
      '--surface', 'discord:abc', 'plan:claude', 'build:codex',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.lanes.length).toBe(2);
    expect(r.surfacePref).toEqual({ kind: 'discord', channelId: 'abc' });
  });

  test('combines with --auto-relay and --focus', () => {
    const r = parseLaneTokens([
      'plan:claude', 'build:codex', 'review:gemini',
      '--surface', 'discord:99', '--auto-relay', '--focus', '0',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.lanes.length).toBe(3);
    expect(r.surfacePref?.kind).toBe('discord');
    expect(r.surfacePref?.channelId).toBe('99');
    expect(r.autoRelay).toBe(true);
    expect(r.focusIndex).toBe(0);
  });

  test('--surface only (no lane tokens) is allowed', () => {
    const r = parseLaneTokens(['--surface', 'discord:42']);
    expect(r.error).toBeUndefined();
    expect(r.lanes).toEqual([]);
    expect(r.surfacePref?.channelId).toBe('42');
  });

  test('--surface without value → error', () => {
    const r = parseLaneTokens(['plan:claude', '--surface']);
    expect(r.error).toMatch(/--surface.*requires a value/);
  });

  test('--surface with malformed value (no colon) → error', () => {
    const r = parseLaneTokens(['plan:claude', '--surface', 'discord']);
    expect(r.error).toMatch(/kind:id/);
  });

  test('--surface with empty id → error', () => {
    const r = parseLaneTokens(['plan:claude', '--surface', 'discord:']);
    expect(r.error).toMatch(/kind:id/);
  });

  test('--surface with unsupported kind → error', () => {
    const r = parseLaneTokens(['plan:claude', '--surface', 'telegram:42']);
    expect(r.error).toMatch(/v1.*'discord'.*only/);
  });

  test('no --surface → surfacePref undefined', () => {
    const r = parseLaneTokens(['plan:claude']);
    expect(r.surfacePref).toBeUndefined();
  });
});
