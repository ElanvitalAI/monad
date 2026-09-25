import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  formatReworkProgressLine,
  UNMEASURED_ATTEMPT_ORDINAL,
} from './orchestrator.js';

const orchestratorSource = readFileSync(new URL('./orchestrator.ts', import.meta.url), 'utf8');

describe('rework progress line', () => {
  it('appends a measured relaunch ordinal of two or greater while preserving rework text', () => {
    expect(formatReworkProgressLine(1, 3, 'none', 2)).toBe('rework 1/3 · 재발사 2 — 수정 중…');
    expect(formatReworkProgressLine(2, 4, 'better', 3)).toBe('rework 2/4·better · 재발사 3 — 수정 중…');
  });

  it('keeps first and unmeasured attempts free of relaunch text', () => {
    expect(formatReworkProgressLine(1, 3, 'none', 1)).toBe('rework 1/3 — 수정 중…');
    expect(formatReworkProgressLine(1, 3, 'none', UNMEASURED_ATTEMPT_ORDINAL)).toBe('rework 1/3 — 수정 중…');
  });

  it('preserves the distinct round-zero implementation message at its progress call site', () => {
    expect(orchestratorSource).toContain("round === 0\n      ? '구현 중 (헤드리스 goal-loop·수분 소요)…'");
  });

  it('wires the incremented ordinal to the rework formatter without a run-supervisor dependency', () => {
    expect(orchestratorSource).toContain('const attemptOrdinal = incrementRunAttemptOrdinal(runId);');
    expect(orchestratorSource).toContain('formatReworkProgressLine(round, effectiveMax, escalateTier, attemptOrdinal)');
    expect(orchestratorSource).not.toContain('run-supervisor');
  });
});
