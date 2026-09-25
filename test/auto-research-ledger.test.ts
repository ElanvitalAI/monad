// ── PFC-S3 P3: experiment ledger + NOW.md ──

import { describe, test, expect, beforeEach } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ExperimentLedger,
  type ExperimentMeta,
} from '../src/auto-research/experiment-ledger';

function scratchLedger(): ExperimentLedger {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-test-'));
  return new ExperimentLedger(dir);
}

describe('PFC-S3 P3 — ExperimentLedger', () => {
  let ledger: ExperimentLedger;
  beforeEach(() => { ledger = scratchLedger(); });

  test('create writes meta.json with createdAt + status=running', () => {
    const m = ledger.create({ goalSlug: 'sample', step: 1 });
    expect(m.status).toBe('running');
    expect(m.createdAt).toBeGreaterThan(0);
    expect(existsSync(join(ledger.experimentDir(m.id), 'meta.json'))).toBe(true);
  });

  test('update merges patch + bumps updatedAt', () => {
    const m = ledger.create({ goalSlug: 'sample', step: 1, hypothesis: 'h1' }, 1000);
    const updated = ledger.update(m.id, { status: 'validated', result: 'ok' }, 2000);
    expect(updated.status).toBe('validated');
    expect(updated.result).toBe('ok');
    expect(updated.hypothesis).toBe('h1');
    expect(updated.createdAt).toBe(1000);
    expect(updated.updatedAt).toBe(2000);
  });

  test('get missing id → null', () => {
    expect(ledger.get('nope')).toBeNull();
  });

  test('list filters by status', () => {
    ledger.create({ goalSlug: 'g', step: 1 });
    const b = ledger.create({ goalSlug: 'g', step: 1 });
    ledger.update(b.id, { status: 'validated' });
    const validated = ledger.list({ status: 'validated' });
    expect(validated.length).toBe(1);
    expect(validated[0]!.id).toBe(b.id);
  });

  test('sameStepBaseline returns most recent VALIDATED at same step', () => {
    const a = ledger.create({ goalSlug: 'g', step: 1 }, 1000);
    ledger.update(a.id, { status: 'validated' }, 1100);
    const b = ledger.create({ goalSlug: 'g', step: 1 }, 1200);
    ledger.update(b.id, { status: 'validated' }, 1300);
    const c = ledger.create({ goalSlug: 'g', step: 1 }, 1400);
    const base = ledger.sameStepBaseline(c.id);
    expect(base?.id).toBe(b.id);
  });

  test('sameStepBaseline — no match across different steps', () => {
    const a = ledger.create({ goalSlug: 'g', step: 1 });
    ledger.update(a.id, { status: 'validated' });
    const b = ledger.create({ goalSlug: 'g', step: 2 });
    expect(ledger.sameStepBaseline(b.id)).toBeNull();
  });

  test('explicit baselineId overrides dynamic lookup', () => {
    const a = ledger.create({ goalSlug: 'g', step: 9 });
    const b = ledger.create({ goalSlug: 'g', step: 1, baselineId: a.id });
    expect(ledger.sameStepBaseline(b.id)?.id).toBe(a.id);
  });

  test('writeNow / readNow round-trip', () => {
    ledger.writeNow('# NOW\nhandoff text');
    expect(ledger.readNow()).toContain('handoff text');
  });

  test('readNow missing → null', () => {
    expect(ledger.readNow()).toBeNull();
  });
});
