// Caveat #3 follow-up (2026-05-08) — `elanous wf` alias + legacy nudge.
//
// Smoke-tests the CLI surface via subprocess so we exercise commander
// the same way real users do (rather than re-running the in-process
// action handlers, which already have coverage in cli-workflow.test.ts).

import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'child_process';
import { resolve } from 'path';

const ENTRY = resolve(import.meta.dir, '..', 'src', 'index.ts');

function run(args: string[], env: Record<string, string> = {}): { code: number; stdout: string; stderr: string } {
  const r = spawnSync('bun', [ENTRY, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  });
  return {
    code: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

describe('elanous wf — plural alias `workflows`', () => {
  it('`elanous workflows --help` lands on the DAG runtime help', () => {
    const r = run(['workflows', '--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('YAML DAG workflows');
    expect(r.stdout).toMatch(/Run a workflow|Print a workflow YAML/);
  });

  it('`elanous wf --help` shows the same help with the alias hint', () => {
    const r = run(['wf', '--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('YAML DAG workflows');
    // Commander renders both names like `wf|workflows` in usage.
    expect(r.stdout).toMatch(/wf\|workflows/);
  });

  it('`elanous workflows list` runs and surfaces builtin workflows', () => {
    const r = run(['workflows', 'list']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('quick-summary');
    expect(r.stdout).toContain('pdca-cycle');
  });
});

describe('elanous workflow — singular alias for elanous wf', () => {
  // `elanous workflow` is wired as an alias on the `wf` command
  // (workflow-runtime DAG) alongside the plural `elanous workflows`,
  // so the natural-language singular form works identically.

  it('`elanous workflow list` runs and surfaces builtin workflows', () => {
    const r = run(['workflow', 'list']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('quick-summary');
    expect(r.stdout).toContain('pdca-cycle');
  });

  it('`elanous workflow --help` shows DAG runtime help with alias hint', () => {
    const r = run(['workflow', '--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('YAML DAG workflows');
    // Commander only renders the first alias in the Usage line; the
    // singular `workflow` appears in the description copy.
    expect(r.stdout).toMatch(/wf\|workflows/);
    expect(r.stdout).toContain('`workflow` (singular)');
  });
});

describe('elanous task / scheduler — retired (scheduler retirement R1)', () => {
  // Scheduler-retirement ROADMAP §R1: `elanous task` (scheduler task
  // management) and `elanous scheduler` family retired. They emit a
  // retirement notice + exit 1 + redirect users to `elanous wf`.
  // ui.error / ui.info write through the UI helper (stdout), so the
  // tests inspect the combined output rather than stderr.
  const combined = (r: { stdout: string; stderr: string }): string => `${r.stdout}${r.stderr}`;

  it('`elanous task list` exits non-zero with retirement notice', () => {
    const r = run(['task', 'list']);
    expect(r.code).not.toBe(0);
    expect(combined(r)).toContain('retired');
    expect(combined(r)).toContain('elanous wf');
  });

  it('`elanous scheduler list` exits non-zero with retirement notice', () => {
    const r = run(['scheduler', 'list']);
    expect(r.code).not.toBe(0);
    expect(combined(r)).toContain('retired');
    expect(combined(r)).toContain('elanous wf');
  });

  it('`elanous sched` alias also routes to retirement notice', () => {
    const r = run(['sched', 'list']);
    expect(r.code).not.toBe(0);
    expect(combined(r)).toContain('retired');
  });
});
