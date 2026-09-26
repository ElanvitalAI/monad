import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = new URL('../..', import.meta.url).pathname;

function runParticipantRegistration(stateDir: string, runId?: string, createRun = true, parentStateDir?: string, createParentRun = true): unknown {
  const script = `
    import { startPty, setPtyAdapterForTesting, unregisterPty } from './src/pty-shell/registry.ts';
    import { saveSelfDevRun, loadSelfDevRun, selfDevRunsDir } from './src/self-dev/run-store.ts';
    const runId = process.env.ELANOUS_RUN_ID;
    const parentDir = process.env.ELANOUS_PARENT_SELF_DEV_RUNS_DIR;
    if (runId && ${createRun}) saveSelfDevRun({ runId, createdAt: 1, updatedAt: 1, results: [] });
    if (runId && parentDir && ${createParentRun}) saveSelfDevRun({ runId, createdAt: 1, updatedAt: 1, results: [] }, parentDir);
    setPtyAdapterForTesting(() => ({ pid: 1, write() {}, kill() {}, resize() {}, onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }) }));
    const handle = startPty({ cmd: 'x', detach: true });
    console.log(JSON.stringify({ id: handle.id, run: runId ? loadSelfDevRun(runId) : null, parentRun: runId && parentDir ? loadSelfDevRun(runId, parentDir) : null, localDir: selfDevRunsDir() }));
    unregisterPty(handle.id);
  `;
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production', ELANOUS_STATE_DIR: stateDir };
  if (runId) env.ELANOUS_RUN_ID = runId;
  else delete env.ELANOUS_RUN_ID;
  if (parentStateDir) env.ELANOUS_PARENT_SELF_DEV_RUNS_DIR = join(parentStateDir, 'self-dev-runs');
  else delete env.ELANOUS_PARENT_SELF_DEV_RUNS_DIR;
  const result = Bun.spawnSync([process.execPath, '-e', script], {
    cwd: repo,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(result.exitCode).toBe(0);
  return JSON.parse(new TextDecoder().decode(result.stdout));
}

describe('startPty run participant registration', () => {
  test('adds an inherited run PTY participant without changing the manifest gate', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'pty-run-participant-'));
    try {
      const result = runParticipantRegistration(stateDir, 'run-parent') as { id: string; run: { participants?: unknown[] } };
      expect(result.run.participants).toEqual([{
        id: result.id,
        kind: 'pty',
        transports: [{ kind: 'pty', id: result.id }],
        registeredAt: expect.any(Number),
        runIdSource: 'inherited',
      }]);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test('registers an inherited child PTY in both its local and explicit parent run stores', () => {
    const childStateDir = mkdtempSync(join(tmpdir(), 'pty-run-participant-child-'));
    const parentStateDir = mkdtempSync(join(tmpdir(), 'pty-run-participant-parent-'));
    try {
      const result = runParticipantRegistration(childStateDir, 'run-parent', true, parentStateDir) as { id: string; run: { participants?: unknown[] }; parentRun: { participants?: unknown[] } };
      expect(result.run.participants).toEqual([expect.objectContaining({ id: result.id, kind: 'pty', runIdSource: 'inherited' })]);
      expect(result.parentRun.participants).toEqual([expect.objectContaining({ id: result.id, kind: 'pty', runIdSource: 'inherited' })]);
    } finally {
      rmSync(childStateDir, { recursive: true, force: true });
      rmSync(parentStateDir, { recursive: true, force: true });
    }
  });

  test('does not create a missing explicit parent run record', () => {
    const childStateDir = mkdtempSync(join(tmpdir(), 'pty-run-participant-child-'));
    const parentStateDir = mkdtempSync(join(tmpdir(), 'pty-run-participant-parent-missing-'));
    try {
      const result = runParticipantRegistration(childStateDir, 'run-parent-missing', true, parentStateDir, false) as { run: { participants?: unknown[] }; parentRun: null };
      expect(result.run.participants).toHaveLength(1);
      expect(result.parentRun).toBeNull();
    } finally {
      rmSync(childStateDir, { recursive: true, force: true });
      rmSync(parentStateDir, { recursive: true, force: true });
    }
  });

  test('a PTY outside a run does not create a run record', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'pty-run-participant-none-'));
    try {
      const result = runParticipantRegistration(stateDir) as { run: null };
      expect(result.run).toBeNull();
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test('an inherited run ID without a record does not create a ghost run', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'pty-run-participant-ghost-'));
    try {
      const result = runParticipantRegistration(stateDir, 'run-missing', false) as { run: null };
      expect(result.run).toBeNull();
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
