// ── PFC-S3 P2: budget meter ──

import { describe, test, expect } from 'bun:test';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BudgetMeter,
  BUDGET_WARNING_RATIO,
  formatBudgetLine,
} from '../src/auto-research/budget-meter';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'budget-test-'));
}

describe('PFC-S3 P2 — BudgetMeter', () => {
  test('unlimited axes are never tripped', () => {
    const m = new BudgetMeter({});
    m.add({ tokens: 100_000_000, usd: 9999 });
    expect(m.tripped()).toEqual([]);
    expect(m.warning()).toEqual([]);
  });

  test('warning fires at 90% usage', () => {
    const m = new BudgetMeter({ tokens: 1_000 });
    m.add({ tokens: 900 });
    expect(m.warning()).toEqual(['tokens']);
    expect(m.tripped()).toEqual([]);
  });

  test('tripped at 100%', () => {
    const m = new BudgetMeter({ tokens: 1_000 });
    m.add({ tokens: 1_000 });
    expect(m.tripped()).toEqual(['tokens']);
  });

  test('snapshot includes remaining per-axis', () => {
    const m = new BudgetMeter({ tokens: 1_000, usd: 5.0 });
    m.add({ tokens: 300, usd: 1.25 });
    const s = m.snapshot();
    expect(s.remaining.tokens).toBe(700);
    expect(s.remaining.usd).toBeCloseTo(3.75, 2);
  });

  test('weekly reset auto-fires after Monday', () => {
    // Now = Sunday → weekResetAt = next Monday midnight UTC.
    const sun = Date.UTC(2026, 3, 12, 12, 0, 0);     // Apr 12 2026 = Sunday
    const m = new BudgetMeter({ weeklyUsd: 5 }, undefined, sun);
    m.add({ weeklyUsd: 4 }, sun);
    expect(m.rawUsage().weeklyUsd).toBe(4);
    const mon = Date.UTC(2026, 3, 13, 1, 0, 0);      // Mon 01:00 UTC
    m.add({ weeklyUsd: 1 }, mon);
    expect(m.rawUsage().weeklyUsd).toBe(1);   // reset then +1
  });

  test('initial usage restores mid-session', () => {
    const m = new BudgetMeter({ tokens: 100 }, { tokens: 40, wallclockMs: 0, usd: 0, weeklyUsd: 0, weekResetAt: Date.now() + 1e9 });
    m.add({ tokens: 30 });
    expect(m.rawUsage().tokens).toBe(70);
  });

  test('persist + load round-trip', async () => {
    const dir = scratch();
    const path = join(dir, 'budget.json');
    const m1 = new BudgetMeter({ tokens: 1_000 });
    m1.add({ tokens: 250 });
    await m1.persist(path);
    expect(existsSync(path)).toBe(true);
    const m2 = BudgetMeter.load(path, { tokens: 1_000 });
    expect(m2.rawUsage().tokens).toBe(250);
  });

  test('rejects negative delta', () => {
    const m = new BudgetMeter({});
    expect(() => m.add({ tokens: -1 })).toThrow(/negative/);
  });

  test('multi-axis trip', () => {
    const m = new BudgetMeter({ tokens: 10, usd: 1 });
    m.add({ tokens: 10, usd: 1 });
    expect(m.tripped().sort()).toEqual(['tokens', 'usd']);
  });

  test('formatBudgetLine renders tokens + usd + wallclock', () => {
    const m = new BudgetMeter({ tokens: 1_000_000, usd: 5, wallclockMs: 4 * 3600 * 1000 });
    m.add({ tokens: 340_000, usd: 0.8, wallclockMs: 2 * 3600 * 1000 + 12 * 60 * 1000 });
    const line = formatBudgetLine(m.snapshot());
    expect(line).toContain('tokens');
    expect(line).toContain('$0.80');
    expect(line).toContain('2h');
  });
});

describe('PFC-S3 P2 — BUDGET_WARNING_RATIO', () => {
  test('is 0.9', () => {
    expect(BUDGET_WARNING_RATIO).toBe(0.9);
  });
});
