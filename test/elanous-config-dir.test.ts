// `--config-dir <dir>` + `getElanousConfigDir()` resolver tests.
//
// 2026-05-13 · config-dir-unify — removes the `ELANOUS_DAEMON_DIR` env
// var read and the `setElanousConfigDir` env mirror. The single public
// surface is the `--config-dir` CLI flag (which calls the
// programmatic setter). Child processes inherit via `--config-dir`
// re-appended to argv in `bg-launch.ts`, not via env inheritance.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  extractConfigDirFlag,
  applyConfigDirFlagFromArgv,
} from '../src/cli/config-dir-flag';
import {
  getElanousConfigDir,
  setElanousConfigDir,
  resetElanousConfigDir,
} from '../src/elanous-config-dir';
import {
  resetEffectiveInstanceRoot,
  setTreeDerivedTestForTesting,
} from '../src/instance/resolve';

let savedArgv: string[];
let savedDaemonDir: string | undefined;
let savedStateDir: string | undefined;

beforeEach(() => {
  savedArgv = [...process.argv];
  // Preserve externally-set env vars while asserting that the resolver ignores them.
  savedDaemonDir = process.env.ELANOUS_DAEMON_DIR;
  savedStateDir = process.env.ELANOUS_STATE_DIR;
  delete process.env.ELANOUS_DAEMON_DIR;
  delete process.env.ELANOUS_STATE_DIR;
  resetElanousConfigDir();
  // Test-state isolation: standalone measurement found a memoized resolver layer
  // below getElanousConfigDir, so every test starts after its existing reset seam.
  // Tree-derived policy is intentionally not forced in this shared lifecycle.
  resetEffectiveInstanceRoot();
});

/** Exercise layer four only where the assertion explicitly promises ~/.elanous.
 *
 * Standalone measurement returned the same cwd/.elanous-test value in all four
 * failing assertions when the host's tree-derived policy was enabled. Explicit
 * override and ELANOUS_STATE_DIR each recovered through their own existing cleanup,
 * so the four failures have one root: unisolated host policy, not four leaks.
 * Keep that policy override local so other tests still exercise the real resolver. */
function selectLayerFourDefaultForAssertion(): void {
  setTreeDerivedTestForTesting(false);
}

afterEach(() => {
  process.argv = savedArgv;
  if (savedDaemonDir === undefined) delete process.env.ELANOUS_DAEMON_DIR;
  else process.env.ELANOUS_DAEMON_DIR = savedDaemonDir;
  if (savedStateDir === undefined) delete process.env.ELANOUS_STATE_DIR;
  else process.env.ELANOUS_STATE_DIR = savedStateDir;
  resetElanousConfigDir();
  setTreeDerivedTestForTesting(undefined);
  resetEffectiveInstanceRoot();
});

describe('extractConfigDirFlag · pure parser', () => {
  it('returns undefined when the flag is absent', () => {
    const r = extractConfigDirFlag(['elanous', 'nexus', 'run']);
    expect(r.dir).toBeUndefined();
    expect(r.argv).toEqual(['elanous', 'nexus', 'run']);
  });

  it('parses `--config-dir <dir>` at the global position', () => {
    const r = extractConfigDirFlag(['elanous', '--config-dir', '/tmp/x', 'nexus', 'run']);
    expect(r.dir).toBe('/tmp/x');
    expect(r.argv).toEqual(['elanous', 'nexus', 'run']);
  });

  it('parses `--config-dir <dir>` after a subcommand', () => {
    const r = extractConfigDirFlag(['elanous', 'nexus', 'run', '--config-dir', '/tmp/y']);
    expect(r.dir).toBe('/tmp/y');
    expect(r.argv).toEqual(['elanous', 'nexus', 'run']);
  });

  it('parses the `--config-dir=<dir>` long form', () => {
    const r = extractConfigDirFlag(['elanous', 'wf', 'validate', '--config-dir=/tmp/z', './flow.yaml']);
    expect(r.dir).toBe('/tmp/z');
    expect(r.argv).toEqual(['elanous', 'wf', 'validate', './flow.yaml']);
  });

  it('trims whitespace', () => {
    const r = extractConfigDirFlag(['elanous', '--config-dir', '  /tmp/spaced  ']);
    expect(r.dir).toBe('/tmp/spaced');
  });

  it('ignores `--config-dir=` with an empty value', () => {
    const r = extractConfigDirFlag(['elanous', '--config-dir=', 'nexus']);
    expect(r.dir).toBeUndefined();
    expect(r.argv).toEqual(['elanous', 'nexus']);
  });

  it('last occurrence wins when the flag is repeated', () => {
    const r = extractConfigDirFlag(['elanous', '--config-dir', '/a', '--config-dir=/b']);
    expect(r.dir).toBe('/b');
  });

  it('does not mutate the input array', () => {
    const argv = ['elanous', '--config-dir', '/tmp/x', 'nexus'];
    const snapshot = [...argv];
    extractConfigDirFlag(argv);
    expect(argv).toEqual(snapshot);
  });
});

describe('applyConfigDirFlagFromArgv · side-effecting bootstrap', () => {
  it('routes the flag through setElanousConfigDir', () => {
    process.argv = ['bun', 'src/index.ts', '--config-dir', '/tmp/applied', 'nexus', 'run'];
    const dir = applyConfigDirFlagFromArgv();
    expect(dir).toBe('/tmp/applied');
    expect(getElanousConfigDir()).toBe('/tmp/applied');
    expect(process.argv).toEqual(['bun', 'src/index.ts', 'nexus', 'run']);
  });

  it('is a no-op when the flag is absent', () => {
    selectLayerFourDefaultForAssertion();
    process.argv = ['bun', 'src/index.ts', 'nexus', 'run'];
    const dir = applyConfigDirFlagFromArgv();
    expect(dir).toBeUndefined();
    expect(getElanousConfigDir()).toBe(join(homedir(), '.elanous'));
  });
});

describe('getElanousConfigDir · resolver-state isolation', () => {
  it('restores explicit override independently through resetElanousConfigDir', () => {
    selectLayerFourDefaultForAssertion();
    setElanousConfigDir('/tmp/explicit-contamination');
    expect(getElanousConfigDir()).toBe('/tmp/explicit-contamination');
    resetElanousConfigDir();
    expect(getElanousConfigDir()).toBe(join(homedir(), '.elanous'));
  });

  it('restores ELANOUS_STATE_DIR independently through environment cleanup', () => {
    selectLayerFourDefaultForAssertion();
    process.env.ELANOUS_STATE_DIR = '/tmp/state-contamination';
    expect(getElanousConfigDir()).toBe('/tmp/state-contamination');
    delete process.env.ELANOUS_STATE_DIR;
    expect(getElanousConfigDir()).toBe(join(homedir(), '.elanous'));
  });

  // ⛔⭐ 이 시험의 «전제»는 「이 체크아웃이 «비-리더» 트리다」이다 — 리더 트리(주 저장소)에서는
  //   3층 스위치를 켜도 뿌리가 «기본값 그대로»라 `not.toBe(defaultDir)` 이 성립하지 않는다.
  //   `src/instance/resolve.ts` 의 그 주석이 이미 이 계급을 이름으로 적어 뒀다 —
  //   *"스위치를 켠 머신에서는 … 옛 테스트가 전부 빨개지고, 끈 머신에서는 3층 경로가 한 번도 안 돌아"*.
  // ⇒ 그러므로 전제를 «단언»하지 않고 «선언»한다: 성립하는 트리에서만 본론을 재고,
  //   안 성립하면 그 사실을 남기고 통과시킨다(⛔ 조용히 건너뛰지 않는다 — 왜 안 쟀는지가 보인다).
  it('restores a memoized tree root through the existing test reset seam', () => {
    const defaultDir = join(homedir(), '.elanous');
    setTreeDerivedTestForTesting(true);
    const treeDerivedDir = getElanousConfigDir();
    setTreeDerivedTestForTesting(false);
    resetEffectiveInstanceRoot();
    // ⚠️ 리더 트리에서는 `treeDerivedDir === defaultDir` 이라 이 단언이 «되돌림»을 못 잰다(공허하게 참).
    //    비-리더 트리에서만 실제로 문다. 그 사실을 산출에 남긴다.
    if (treeDerivedDir === defaultDir) console.warn('[premise] 리더 트리 — 3층 뿌리가 기본과 같아 되돌림을 못 쟀다');
    expect(getElanousConfigDir()).toBe(defaultDir);
  });

  it('measures the combined inputs as independent precedence layers, not extra leaks', () => {
    setTreeDerivedTestForTesting(true);
    const treeDerivedDir = getElanousConfigDir();
    setElanousConfigDir('/tmp/explicit-contamination');
    process.env.ELANOUS_STATE_DIR = '/tmp/state-contamination';
    expect(getElanousConfigDir()).toBe('/tmp/explicit-contamination');
    resetElanousConfigDir();
    expect(getElanousConfigDir()).toBe('/tmp/state-contamination');
    delete process.env.ELANOUS_STATE_DIR;
    expect(getElanousConfigDir()).toBe(treeDerivedDir);
    selectLayerFourDefaultForAssertion();
    expect(getElanousConfigDir()).toBe(join(homedir(), '.elanous'));
  });
});

describe('getElanousConfigDir · resolution order (env-var-free)', () => {
  it('defaults to ~/.elanous when nothing is set', () => {
    selectLayerFourDefaultForAssertion();
    expect(getElanousConfigDir()).toBe(join(homedir(), '.elanous'));
  });

  it('IGNORES ELANOUS_DAEMON_DIR env var (removed 2026-05-13)', () => {
    selectLayerFourDefaultForAssertion();
    process.env.ELANOUS_DAEMON_DIR = '/tmp/env-must-be-ignored';
    expect(getElanousConfigDir()).toBe(join(homedir(), '.elanous'));
  });

  it('honours programmatic override', () => {
    setElanousConfigDir('/tmp/override');
    expect(getElanousConfigDir()).toBe('/tmp/override');
  });

  it('setElanousConfigDir does NOT mirror into env (env removed 2026-05-13)', () => {
    delete process.env.ELANOUS_DAEMON_DIR;
    setElanousConfigDir('/tmp/no-mirror');
    expect(process.env.ELANOUS_DAEMON_DIR).toBeUndefined();
  });

  it('resetElanousConfigDir falls back to ~/.elanous regardless of env', () => {
    selectLayerFourDefaultForAssertion();
    setElanousConfigDir('/tmp/will-be-cleared');
    resetElanousConfigDir();
    expect(getElanousConfigDir()).toBe(join(homedir(), '.elanous'));
    // Even with a stray env var, the resolver remains env-blind.
    process.env.ELANOUS_DAEMON_DIR = '/tmp/still-ignored';
    expect(getElanousConfigDir()).toBe(join(homedir(), '.elanous'));
  });

  it('setElanousConfigDir rejects empty strings', () => {
    expect(() => setElanousConfigDir('')).toThrow();
    expect(() => setElanousConfigDir('   ')).toThrow();
  });

  it('trims the override', () => {
    setElanousConfigDir('  /tmp/trimmed  ');
    expect(getElanousConfigDir()).toBe('/tmp/trimmed');
  });
});

describe('downstream consumers honour the central resolver', () => {
  it('elanousDaemonDir returns the central value', async () => {
    const { elanousDaemonDir } = await import('../src/elanous-daemon.js');
    setElanousConfigDir('/tmp/daemon-test');
    expect(elanousDaemonDir()).toBe('/tmp/daemon-test');
  });

  it('nexus elanousConfigDir + userConfigPath honour the override', async () => {
    const { elanousConfigDir, userConfigPath, secretsPath } = await import('../src/nexus/config/paths.js');
    setElanousConfigDir('/tmp/nexus-test');
    expect(elanousConfigDir()).toBe('/tmp/nexus-test');
    expect(userConfigPath()).toBe('/tmp/nexus-test/config.json');
    expect(secretsPath()).toBe('/tmp/nexus-test/secrets.json');
  });

  it('workflow-runtime getGlobalWorkflowDir honours the override', async () => {
    const { getGlobalWorkflowDir } = await import('../src/workflow-runtime/discovery.js');
    setElanousConfigDir('/tmp/wf-test');
    expect(getGlobalWorkflowDir()).toBe('/tmp/wf-test/workflows');
  });
});
