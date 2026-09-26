import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AcpAgent } from '../src/acp/client.js';
import { ACP_BACKENDS } from '../src/acp/backend-registry.js';
import { resetElanousConfigDir, setElanousConfigDir } from '../src/elanous-config-dir.js';
import { resetUserConfig } from '../src/user-config.js';

const STUB_ID = 'test-bin-path-config-stub';
const stubPath = join(import.meta.dir, 'fixtures', 'acp-initialize-stub.ts');
let configDir: string;

beforeAll(() => {
  ACP_BACKENDS[STUB_ID] = {
    id: STUB_ID,
    label: 'binary path config stub (test only)',
    command: 'bun',
    args: [stubPath],
    npmPackage: '',
    npmVersion: '',
  };
});

afterAll(() => { delete ACP_BACKENDS[STUB_ID]; });

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'acp-bin-path-'));
  setElanousConfigDir(configDir);
  resetUserConfig();
});

afterEach(() => {
  resetUserConfig();
  resetElanousConfigDir();
  rmSync(configDir, { recursive: true, force: true });
});

function writeConfig(acp: unknown): void {
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({ acp }));
  resetUserConfig();
}

function makeAgent(logs: string[]): AcpAgent {
  return new AcpAgent({
    backendId: STUB_ID,
    cwd: process.cwd(),
    log: (message) => logs.push(message),
  });
}

function expectSpawnObservation(
  logs: string[],
  expected: { bin: string; args: string; path: string; reason: 'configured' | 'configured-missing' | 'default' },
): void {
  expect(logs).toContainEqual(expect.stringMatching(
    new RegExp(
      `^spawning ${escapeRegExp(expected.bin)} ${escapeRegExp(expected.args)} `
      + `\\(path=${escapeRegExp(expected.path)}, reason=${escapeRegExp(expected.reason)}(?:, .*|)\\)$`,
    ),
  ));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('AcpAgent configured binary paths', () => {
  test('uses a configured backend path before normal lookup and observes the selection reason', async () => {
    writeConfig({ binaryPaths: { [STUB_ID]: process.execPath } });
    const logs: string[] = [];
    const agent = makeAgent(logs);

    try {
      await agent.start();
      expectSpawnObservation(logs, {
        bin: process.execPath,
        args: stubPath,
        path: process.execPath,
        reason: 'configured',
      });
    } finally {
      await agent.stop().catch(() => {});
    }
  }, 20_000);

  test('records a missing configured path instead of silently falling through', async () => {
    const missingPath = join(configDir, 'does-not-exist');
    writeConfig({ binaryPaths: { [STUB_ID]: missingPath } });
    const logs: string[] = [];

    await expect(makeAgent(logs).start()).rejects.toThrow('acp spawn failed');
    expectSpawnObservation(logs, {
      bin: missingPath,
      args: stubPath,
      path: missingPath,
      reason: 'configured-missing',
    });
  });

  test('keeps the existing default fallback when no path is configured and when config is unreadable', async () => {
    writeFileSync(join(configDir, 'config.json'), '{not-json');
    resetUserConfig();
    const logs: string[] = [];
    const agent = makeAgent(logs);

    try {
      await agent.start();
      expectSpawnObservation(logs, {
        bin: 'bun',
        args: stubPath,
        path: 'bun',
        reason: 'default',
      });
    } finally {
      await agent.stop().catch(() => {});
    }
  }, 20_000);
});
