// PLAN-model-intelligence-router-2026-07-10 · Phase B5 tests.

import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  logRouterDecision,
  readRouterDecisions,
} from '../../src/model-tier/router-decision-log.js';

const dirs: string[] = [];
function tempHome(): string {
  const d = mkdtempSync(join(tmpdir(), 'router-log-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('router-decision-log', () => {
  it('appends and reads back a decision, truncating the preview', () => {
    const home = tempHome();
    logRouterDecision(
      {
        tier: 'best',
        model: 'claude-opus-4-7',
        source: 'heuristic',
        rationale: 'reasoning cue',
        provider: 'anthropic',
        text: 'x'.repeat(500),
        sessionId: 's1',
      },
      { home, now: 111 },
    );
    const rows = readRouterDecisions({ home });
    expect(rows.length).toBe(1);
    expect(rows[0]!.tier).toBe('best');
    expect(rows[0]!.model).toBe('claude-opus-4-7');
    expect(rows[0]!.ts).toBe(111);
    expect(rows[0]!.textPreview!.length).toBe(160);
  });

  it('honours the limit (most-recent last)', () => {
    const home = tempHome();
    for (let i = 0; i < 5; i++) {
      logRouterDecision(
        { tier: 'budget', model: 'm', source: 'heuristic', rationale: String(i), provider: 'anthropic' },
        { home, now: i },
      );
    }
    const rows = readRouterDecisions({ home, limit: 2 });
    expect(rows.length).toBe(2);
    expect(rows[0]!.rationale).toBe('3');
    expect(rows[1]!.rationale).toBe('4');
  });

  it('returns [] for a missing log', () => {
    expect(readRouterDecisions({ home: tempHome() })).toEqual([]);
  });
});
