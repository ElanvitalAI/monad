// ── T4 (Phase 3 Bundle 1) — safe-shell-selector tests ──

import { describe, expect, test } from 'bun:test';
import {
  selectSafeShell,
  groupCandidates,
  type ShellCandidate,
} from '../src/conductor/safe-shell-selector';
import { deriveTerminalCapability } from '../src/terminal/posture';

function candidate(opts: {
  shellId: string;
  exposure: 'user-interactive' | 'observe-only' | 'hidden' | 'unavailable';
}): ShellCandidate {
  return {
    shellId: opts.shellId,
    exposure: opts.exposure,
    capability: deriveTerminalCapability({ userExposure: opts.exposure, agentInteractive: opts.exposure !== 'unavailable' }),
  };
}

describe('selectSafeShell', () => {
  test('empty list → null', () => {
    expect(selectSafeShell([])).toBeNull();
  });

  test('single user-interactive shell → selected', () => {
    const c = [candidate({ shellId: 'a', exposure: 'user-interactive' })];
    const r = selectSafeShell(c);
    expect(r?.shellId).toBe('a');
  });

  test('prefers observe-only over user-interactive when read-only requested (over-grant avoidance)', () => {
    const c = [
      candidate({ shellId: 'rw', exposure: 'user-interactive' }),  // canWrite=true (over-grant)
      candidate({ shellId: 'ro', exposure: 'observe-only' }),       // canRead+canInspect (just enough)
    ];
    const r = selectSafeShell(c, { needsRead: true, needsInspect: true });
    expect(r?.shellId).toBe('ro');
    expect(r?.reason).toContain('exposure=observe-only');
  });

  test('skips unavailable', () => {
    const c = [
      candidate({ shellId: 'dead', exposure: 'unavailable' }),
      candidate({ shellId: 'alive', exposure: 'user-interactive' }),
    ];
    expect(selectSafeShell(c)?.shellId).toBe('alive');
  });

  test('returns null when no candidate meets requirement', () => {
    const c = [candidate({ shellId: 'ro', exposure: 'observe-only' })];
    expect(selectSafeShell(c, { needsWrite: true })).toBeNull();
  });

  test('lex-sorted shellId for tie-break', () => {
    const c = [
      candidate({ shellId: 'b', exposure: 'observe-only' }),
      candidate({ shellId: 'a', exposure: 'observe-only' }),
    ];
    expect(selectSafeShell(c)?.shellId).toBe('a');
  });

  test('exposure priority: user-interactive > observe-only > hidden when capability matches', () => {
    const c = [
      candidate({ shellId: 'h', exposure: 'hidden' }),
      candidate({ shellId: 'o', exposure: 'observe-only' }),
      candidate({ shellId: 'i', exposure: 'user-interactive' }),
    ];
    // No requirement → all match (even hidden has read=false but
    // default needsRead=true, hidden cap.canRead=false → hidden filtered).
    // observe-only and user-interactive both have canRead=true.
    // observe-only is weaker (no canWrite) → wins on cap-score.
    expect(selectSafeShell(c)?.shellId).toBe('o');
  });

  test('hidden filtered when needsRead=true (default)', () => {
    const c = [candidate({ shellId: 'h', exposure: 'hidden' })];
    expect(selectSafeShell(c)).toBeNull();
  });

  test('hidden allowed when needsRead=false', () => {
    const c = [candidate({ shellId: 'h', exposure: 'hidden' })];
    expect(selectSafeShell(c, { needsRead: false })?.shellId).toBe('h');
  });

  test('reason describes selection', () => {
    const c = [candidate({ shellId: 'a', exposure: 'user-interactive' })];
    const r = selectSafeShell(c, { needsWrite: true });
    expect(r?.reason).toContain('for=write');
    expect(r?.reason).toContain('cap-score=');
  });
});

describe('groupCandidates', () => {
  test('separates safe / overGrant / insufficient / unavailable', () => {
    const c = [
      candidate({ shellId: 'rw', exposure: 'user-interactive' }),  // score 5 (read+intr+write+inspect=1+1+2+1)
      candidate({ shellId: 'ro', exposure: 'observe-only' }),       // score 3 (read+intr+inspect=1+1+1)
      candidate({ shellId: 'h', exposure: 'hidden' }),               // score 0 — fails needsRead
      candidate({ shellId: 'd', exposure: 'unavailable' }),
    ];
    // requirement: needsRead+needsInterrupt+needsInspect → minScore = 1+1+1 = 3
    const g = groupCandidates(c, { needsRead: true, needsInterrupt: true, needsInspect: true });
    expect(g.safe.map(s => s.shellId)).toEqual(['ro']);  // exact match score=3
    expect(g.overGrant.map(s => s.shellId)).toEqual(['rw']);  // score=5
    expect(g.insufficient.map(s => s.shellId)).toEqual(['h']);
    expect(g.unavailable.map(s => s.shellId)).toEqual(['d']);
  });

  test('default requirement (needsRead=true)', () => {
    const c = [
      candidate({ shellId: 'h', exposure: 'hidden' }),
      candidate({ shellId: 'o', exposure: 'observe-only' }),
    ];
    const g = groupCandidates(c);
    // observe-only has score 3 (read+interrupt+inspect), default min = 1
    expect(g.insufficient.map(s => s.shellId)).toEqual(['h']);
    expect(g.overGrant.map(s => s.shellId)).toEqual(['o']);
  });
});
