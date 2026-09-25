// Scheduler-retirement R4 (2026-05-11) — workflow-runs listing tests.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { listWorkflowRuns } from '../src/workflow-runtime/runs-listing';

function fixture(name: string, body: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'wf-runs-'));
  const runDir = join(root, name);
  mkdirSync(runDir);
  writeFileSync(join(runDir, 'run.json'), JSON.stringify(body));
  return root;
}

describe('listWorkflowRuns', () => {
  test('returns rows for each run.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-runs-'));
    for (const n of ['r1', 'r2']) {
      mkdirSync(join(dir, n));
      writeFileSync(join(dir, n, 'run.json'), JSON.stringify({
        workflowName: `wf-${n}`,
        runId: n,
        startedAt: 1700000000000,
        completedAt: 1700000060000,
        ok: true,
      }));
    }
    const rows = listWorkflowRuns({ dir });
    expect(rows.length).toBe(2);
    expect(rows.map(r => r.workflowName).sort()).toEqual(['wf-r1', 'wf-r2']);
  });

  test('maps statuses correctly', () => {
    const dir = fixture('a', { workflowName: 'a', startedAt: 1, completedAt: 2, ok: true });
    expect(listWorkflowRuns({ dir })[0].status).toBe('ok');
  });

  test('failed when ok=false or error present', () => {
    const a = fixture('x', { workflowName: 'x', startedAt: 1, completedAt: 2, ok: false });
    const b = fixture('y', { workflowName: 'y', startedAt: 1, completedAt: 2, error: 'boom' });
    expect(listWorkflowRuns({ dir: a })[0].status).toBe('failed');
    expect(listWorkflowRuns({ dir: b })[0].status).toBe('failed');
  });

  test('running when startedAt but no completedAt', () => {
    const dir = fixture('r', { workflowName: 'r', startedAt: 1700000000000 });
    expect(listWorkflowRuns({ dir })[0].status).toBe('running');
  });

  test('skips unreadable / malformed json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-runs-'));
    mkdirSync(join(dir, 'bad'));
    writeFileSync(join(dir, 'bad', 'run.json'), '{not-json');
    mkdirSync(join(dir, 'ok'));
    writeFileSync(join(dir, 'ok', 'run.json'), JSON.stringify({
      workflowName: 'good', startedAt: 1, completedAt: 2, ok: true,
    }));
    const rows = listWorkflowRuns({ dir });
    expect(rows.length).toBe(1);
    expect(rows[0].workflowName).toBe('good');
  });

  test('returns empty array when dir does not exist', () => {
    const rows = listWorkflowRuns({ dir: '/tmp/__definitely_not_a_real_dir__' });
    expect(rows).toEqual([]);
  });

  test('respects limit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-runs-'));
    for (let i = 0; i < 5; i++) {
      const n = `r${i}`;
      mkdirSync(join(dir, n));
      writeFileSync(join(dir, n, 'run.json'), JSON.stringify({
        workflowName: n, startedAt: i, completedAt: i + 1, ok: true,
      }));
    }
    expect(listWorkflowRuns({ dir, limit: 2 }).length).toBe(2);
  });
});
