import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintLedgerDirectory, renderLedgerLint, runLedgerLint } from './ledger-lint.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(document: string): { root: string; file: string } {
  const root = mkdtempSync(join(tmpdir(), 'elanous-ledger-lint-'));
  roots.push(root);
  const area = join(root, 'area');
  mkdirSync(area);
  const file = join(area, 'ISSUES.md');
  writeFileSync(file, document);
  return { root, file };
}

const fourLines = (links: string) => `\n- **근본**: cause ${links}\n- **근거**: evidence\n`;

describe('ledger lint checks', () => {
  test('[three-checks] reports exactly one violation for each named check', () => {
    const { root } = fixture([
      `### H-1 · **pending** — status${fourLines('F1')}`,
      '### H-2 · **open** — four-lines\n- **근거**: evidence F2\n',
      `### F-3 · **open** — forward mismatch${fourLines('I-3')}`,
      `### I-3 · **fixed** — reverse mismatch${fourLines('F-4')}`,
    ].join('\n'));
    const result = lintLedgerDirectory(root);
    expect(result.counts.byCheck).toEqual({ 'status-vocab': 1, 'four-lines': 1, linkage: 1 });
    expect(result.counts.violations).toBe(3);
    expect(result.unremediatedFailures.map((entry) => entry.declaration?.id)).toEqual(['F-3']);
  });

  test('[clean-doc] accepts one complete linked entry', () => {
    const { root } = fixture(`### H-1 · **fixed(goal)** — clean${fourLines('F1')}`);
    const result = lintLedgerDirectory(root);
    expect(result.counts).toEqual({ total: 1, violations: 0, byCheck: { 'status-vocab': 0, 'four-lines': 0, linkage: 0 } });
    expect(renderLedgerLint(result)).toContain('summary total=1 status-vocab=0 four-lines=0 linkage=0 violations=0');
  });

  test('[strict-exit] violations are report-only unless strict is enabled', () => {
    const { root } = fixture('### H-1 · **open** — invalid\n');
    expect(runLedgerLint(root, false).exitCode).toBe(0);
    expect(runLedgerLint(root, true).exitCode).toBe(1);
  });

  test('[readonly] linting does not modify the ledger document', () => {
    const { root, file } = fixture(`### H-1 · **open** — observed${fourLines('F1')}`);
    const before = readFileSync(file, 'utf8');
    lintLedgerDirectory(root);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  test('[mutation] linkage mismatch is observable in the named check', () => {
    const { root } = fixture([
      `### F-1 · **open** — failure${fourLines('I-1')}`,
      `### I-1 · **fixed** — wrong reverse${fourLines('F-2')}`,
    ].join('\n'));
    const result = lintLedgerDirectory(root);
    expect(result.counts.byCheck.linkage).toBe(1);
    expect(result.unremediatedFailures.map((entry) => entry.declaration?.id)).toEqual(['F-1']);
  });
});

describe('ledger identity and remediation integrity', () => {
  test('duplicate failure declarations are each violations and cannot be remediated', () => {
    const duplicate = `### F-1 · **open** — same${fourLines('I-1')}`;
    const { root } = fixture([
      duplicate,
      duplicate,
      `### I-1 · **fixed** — improvement${fourLines('F-1')}`,
    ].join('\n'));
    const result = lintLedgerDirectory(root);
    expect(result.violations.filter((violation) => violation.check === 'linkage').map((violation) => violation.title)).toEqual([
      'F-1 · **open** — same',
      'F-1 · **open** — same',
    ]);
    expect(result.unremediatedFailures).toHaveLength(2);
  });

  test('duplicate improvement declarations are each violations and cannot remediate a failure', () => {
    const { root } = fixture([
      `### F-2 · **open** — failure${fourLines('I-2')}`,
      `### I-2 · **fixed** — first${fourLines('F-2')}`,
      `### I-2 · **fixed** — second${fourLines('F-2')}`,
    ].join('\n'));
    const result = lintLedgerDirectory(root);
    expect(result.violations.filter((violation) => violation.check === 'linkage')).toHaveLength(3);
    expect(result.unremediatedFailures.map((entry) => entry.declaration?.id)).toEqual(['F-2']);
  });

  test('only a fixed improvement with an exact reverse reference remediates a failure', () => {
    const { root } = fixture([
      `### F-7 · **open** — failure${fourLines('I-7')}`,
      `### I-7 · **fixed(#7)** — improvement${fourLines('F7')}`,
    ].join('\n'));
    const result = lintLedgerDirectory(root);
    expect(result.counts.byCheck.linkage).toBe(0);
    expect(result.unremediatedFailures).toEqual([]);
  });

  test('a reciprocal but non-fixed improvement remains unremediated', () => {
    const { root } = fixture([
      `### F-8 · **open** — failure${fourLines('I-8')}`,
      `### I-8 · **open** — improvement${fourLines('F-8')}`,
    ].join('\n'));
    const result = lintLedgerDirectory(root);
    expect(result.counts.byCheck.linkage).toBe(1);
    expect(result.unremediatedFailures.map((entry) => entry.declaration?.id)).toEqual(['F-8']);
  });

  test('a failure declaration without an improvement reference violates linkage', () => {
    const { root } = fixture(`### F-9 · **open** — orphan${fourLines('no link')}`);
    const result = lintLedgerDirectory(root);
    expect(result.counts.byCheck.linkage).toBe(1);
    expect(result.unremediatedFailures.map((entry) => entry.declaration?.id)).toEqual(['F-9']);
  });
});
