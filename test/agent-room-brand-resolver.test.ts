// H6 P4 · brand-resolver unit tests.
//
// Covers the five resolution paths: literal · alias · lll:<model> ·
// `auto` (router · fallback) · `auto:<role>` · plus the R8 diversity
// post-filter exercised by room-builder.

import { describe, test, expect } from 'bun:test';
import { resolveBrand, type PolicyDecideFn } from '../src/agent-room/brand-resolver.js';

function stubDecide(
  responses: Record<string, { brand: string; model?: string }>,
): PolicyDecideFn {
  return ({ task }) => {
    // Match by the canonical role keyword baked into ROLE_TASK.
    for (const key of Object.keys(responses)) {
      if (task.includes(key)) return responses[key]!;
    }
    return { brand: 'codex' };
  };
}

describe('resolveBrand · literal + alias', () => {
  test('literal brand pass-through (registry id `claude`)', () => {
    const r = resolveBrand('claude', undefined);
    expect(r.brand).toBe('claude');
    expect(r.resolution).toBe('literal');
  });

  test('`codex` resolves to canonical codex namespace', () => {
    const r = resolveBrand('codex', undefined);
    expect(r.brand).toBe('codex');
    expect(r.resolution).toBe('alias');
  });

  test('sprint 5B · removed `cxn` alias is treated as a literal', () => {
    // codex-native dep + source removed; the alias entry is gone.
    // Resolver falls through to `literal` so the adapter registry
    // surfaces a clear "unknown brand" error at launch time.
    const r = resolveBrand('cxn', undefined);
    expect(r.brand).toBe('cxn');
    expect(r.resolution).toBe('literal');
  });

  test('alias `clc` → claude', () => {
    const r = resolveBrand('clc', undefined);
    expect(r.brand).toBe('claude');
  });

  test('alias case-insensitive', () => {
    const r = resolveBrand('GEM', undefined);
    expect(r.brand).toBe('gemini');
  });
});

describe('resolveBrand · lll:<model>', () => {
  test('`lll:qwen-32b` produces local-llm with --model extraArgs', () => {
    const r = resolveBrand('lll:qwen-32b', undefined);
    expect(r.brand).toBe('local-llm');
    expect(r.resolution).toBe('alias');
    expect(r.extraArgs).toEqual(['--model', 'qwen-32b']);
  });

  test('`lll:` with empty model omits extraArgs', () => {
    const r = resolveBrand('lll:', undefined);
    expect(r.brand).toBe('local-llm');
    expect(r.extraArgs).toBeUndefined();
  });
});

describe('resolveBrand · auto path', () => {
  test('no router → fallback to codex with warning', () => {
    const r = resolveBrand('auto', 'plan');
    expect(r.brand).toBe('codex');
    expect(r.resolution).toBe('fallback');
    expect(r.warning).toMatch(/not wired/);
  });

  test('with router · roleHint=plan routes by plan task', () => {
    const policyDecide = stubDecide({ plan: { brand: 'claude', model: 'opus' } });
    const r = resolveBrand('auto', 'plan', { policyDecide });
    expect(r.brand).toBe('claude');
    expect(r.resolution).toBe('policy-decide');
    expect(r.extraArgs).toEqual(['--model', 'opus']);
  });

  test('R8 diversity filter · excludeBrands redirects to alternative', () => {
    const policyDecide = stubDecide({ exec: { brand: 'codex' } });
    const r = resolveBrand('auto', 'exec', {
      policyDecide,
      excludeBrands: ['codex'],
    });
    expect(r.resolution).toBe('fallback');
    expect(r.warning).toMatch(/already in room/);
    expect(r.brand).not.toBe('codex');
  });

  test('router throws → fallback with error message in warning', () => {
    const policyDecide: PolicyDecideFn = () => {
      throw new Error('no candidates');
    };
    const r = resolveBrand('auto', 'plan', { policyDecide });
    expect(r.brand).toBe('codex');
    expect(r.resolution).toBe('fallback');
    expect(r.warning).toMatch(/no candidates/);
  });
});

describe('resolveBrand · edge cases', () => {
  test('empty brandRef → fallback to codex', () => {
    const r = resolveBrand('', undefined);
    expect(r.brand).toBe('codex');
    expect(r.resolution).toBe('fallback');
  });
});

// ── PR-CL6 (C.2 · 2026-04-29) — Lane matrix attached to ResolvedBrand
//
// Verifies that `resolveBrand` populates `laneKind` from
// `LANE_MATRIX_BY_BRAND` for every recognized brand, and narrows a
// user-supplied `transportPref` to the supported set (falling back to
// the brand's `defaultLane` on mismatch).

describe('resolveBrand · laneKind (CL6)', () => {
  test('codex defaults to acp lane', () => {
    const r = resolveBrand('codex', undefined);
    expect(r.laneKind).toBe('acp');
  });

  test('claude defaults to pty lane', () => {
    const r = resolveBrand('claude', undefined);
    expect(r.laneKind).toBe('pty');
  });

  test('gemini defaults to pty lane', () => {
    const r = resolveBrand('gemini', undefined);
    expect(r.laneKind).toBe('pty');
  });

  test('monad defaults to acp lane', () => {
    const r = resolveBrand('monad', undefined);
    expect(r.laneKind).toBe('acp');
  });

  test('lll:<model> defaults to pty lane', () => {
    const r = resolveBrand('lll:qwen-32b', undefined);
    expect(r.brand).toBe('local-llm');
    expect(r.laneKind).toBe('pty');
  });

  test('alias `clc` → claude → pty lane', () => {
    const r = resolveBrand('clc', undefined);
    expect(r.brand).toBe('claude');
    expect(r.laneKind).toBe('pty');
  });

  test('user transportPref `pty` narrows codex to pty (supported)', () => {
    const r = resolveBrand('codex', undefined, { transportPref: 'pty' });
    expect(r.laneKind).toBe('pty');
  });

  test('user transportPref `acp` on claude falls back to default (unsupported)', () => {
    const r = resolveBrand('claude', undefined, { transportPref: 'acp' });
    // claude only supports `pty` — `acp` request silently narrows to
    // defaultLane. (transport-compat handles the user-facing warning.)
    expect(r.laneKind).toBe('pty');
  });

  test('user transportPref `auto` defers to brand default', () => {
    const codex = resolveBrand('codex', undefined, { transportPref: 'auto' });
    expect(codex.laneKind).toBe('acp');
    const claude = resolveBrand('claude', undefined, { transportPref: 'auto' });
    expect(claude.laneKind).toBe('pty');
  });

  test('unknown literal brand → laneKind undefined', () => {
    const r = resolveBrand('not-a-real-brand', undefined);
    expect(r.resolution).toBe('literal');
    expect(r.laneKind).toBeUndefined();
  });

  test('empty brandRef → fallback codex → acp lane', () => {
    // Fallback path still goes through attachLaneKind, so the warning
    // message stays intact AND the caller knows which lane to spawn in.
    const r = resolveBrand('', undefined);
    expect(r.brand).toBe('codex');
    expect(r.resolution).toBe('fallback');
    expect(r.laneKind).toBe('acp');
  });
});
