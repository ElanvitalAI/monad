import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '..');

async function runSetup(answerFilePath: string): Promise<{ code: number; stderr: string }> {
  const stateRoot = mkdtempSync(join(tmpdir(), 'setup-cli-state-'));
  try {
    const proc = Bun.spawn(['bun', 'bin/elanous.mjs', 'setup', '--non-interactive', '--config', answerFilePath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: stateRoot,
        XDG_CONFIG_HOME: join(stateRoot, 'config'),
        ELANOUS_STATE_DIR: join(stateRoot, 'state'),
        ELANOUS_SUPPRESS_XDG_WARNING: '1',
        PATH: process.env.PATH ?? '',
      },
      stdout: 'ignore',
      stderr: 'pipe',
    });
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    return { code, stderr };
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
}

describe('setup --non-interactive CLI answer-file failures', () => {
  test('reports an explicit unreadable answer file with its lowest cause and exits 1', async () => {
    const root = mkdtempSync(join(tmpdir(), 'setup-cli-unreadable-'));
    const answerFilePath = join(root, 'missing.json');
    try {
      const result = await runSetup(answerFilePath);

      expect(result.code).toBe(1);
      expect(result.stderr).toBe(`setup: 답변 파일을 읽을 수 없다 — ${answerFilePath}\nENOENT: no such file or directory, open '${answerFilePath}'\n`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  test('reports an explicit malformed answer file with its lowest cause and exits 1', async () => {
    const root = mkdtempSync(join(tmpdir(), 'setup-cli-malformed-'));
    const answerFilePath = join(root, 'answers.json');
    try {
      writeFileSync(answerFilePath, '{not json}');
      const result = await runSetup(answerFilePath);

      expect(result.code).toBe(1);
      expect(result.stderr).toBe(`setup: 답변 파일을 읽을 수 없다 — ${answerFilePath}\nJSON Parse error: Expected '}'\n`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
