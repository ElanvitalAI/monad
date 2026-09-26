import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');

test('real CLI walks docs publication in dry-run mode without executing commands', () => {
  const proc = Bun.spawnSync(['bun', 'bin/elanous.mjs', '--test', 'graph', 'run', 'graphs/ops/docs-publish.yaml', '--dry-run', '--json'], {
    cwd: root, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ELANOUS_STATE_DIR: resolve(root, '.elanous-test') },
  });
  expect(new TextDecoder().decode(proc.stderr)).not.toContain('unknown command');
  expect(proc.exitCode).toBe(0);
  const state = JSON.parse(new TextDecoder().decode(proc.stdout));
  expect(state.path).toEqual(['build', 'deploy', 'done']);
  expect(state.executed).toBe(0);
  expect(state.dryRun).toBe(true);
  const status = Bun.spawnSync(['bun', 'bin/elanous.mjs', '--test', 'graph', 'status', 'docs-publish', '--json'], {
    cwd: root, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ELANOUS_STATE_DIR: resolve(root, '.elanous-test') },
  });
  expect(status.exitCode).toBe(0);
  expect(JSON.parse(new TextDecoder().decode(status.stdout))).toMatchObject({ runId: state.runId, path: state.path, executed: 0 });
});
