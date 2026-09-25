// NEXUS · resolveToolsKind() resolution order
//
// Pre-fix: in-process runNexus fell back to 'none' while deriveChildEnv
// (daemon tab spawn) fell back to switch default 'webterm'. Two surfaces
// of the same daemon disagreed on the same UserConfig — surprising
// divergence the user had no way to discover.
//
// Post-fix: in-process branch + daemon spawn both honor the same chain:
// CLI flag > env > UserConfig switch > switch default ('webterm').

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAgentTurnToolsKind, resolveToolsKind } from '../src/nexus/index.js';
import { userConfigPath } from '../src/nexus/config/paths.js';
import { clearSwitchRegistry } from '../src/nexus/config/switch-registry.js';
import { reloadAllBuiltins } from '../src/nexus/config/builtins/index.js';
import { USER_CONFIG_VERSION } from '../src/nexus/config/types.js';
import { resetMonadConfigDir, setMonadConfigDir } from '../src/monad-config-dir.js';

let tmpRoot: string;
let prevTools: string | undefined;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'monad-nexus-tools-resolve-'));
  prevTools = process.env.MONAD_TOOLS;
  // Isolate UserConfig path so the host's ~/.monad/config.json doesn't
  // bleed into the resolver AND so writeToolsSwitch() doesn't pollute
  // it. The legacy `MONAD_DAEMON_DIR` env var was removed in PR #2534
  // (config-dir-unify) — use the programmatic override instead.
  setMonadConfigDir(tmpRoot);
  delete process.env.MONAD_TOOLS;
  clearSwitchRegistry();
  reloadAllBuiltins();
});

afterEach(() => {
  resetMonadConfigDir();
  if (prevTools === undefined) delete process.env.MONAD_TOOLS;
  else process.env.MONAD_TOOLS = prevTools;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  clearSwitchRegistry();
});

function writeToolsSwitch(value: string): void {
  mkdirSync(tmpRoot, { recursive: true });
  writeFileSync(
    userConfigPath(),
    JSON.stringify({
      version: USER_CONFIG_VERSION,
      global: { tools: value },
      tabs: {},
    }),
  );
}

describe('resolveToolsKind — default fallback aligned with switch default', () => {
  test('no flag / no env / no switch → webterm (was: none, pre-fix)', () => {
    expect(resolveToolsKind({})).toBe('webterm');
  });

  test('CLI flag wins (priority 1)', () => {
    process.env.MONAD_TOOLS = 'readonly';
    writeToolsSwitch('none');
    expect(resolveToolsKind({ tools: 'none' })).toBe('none');
  });

  test('env wins over switch (priority 2)', () => {
    process.env.MONAD_TOOLS = 'readonly';
    writeToolsSwitch('none');
    expect(resolveToolsKind({})).toBe('readonly');
  });

  test('switch wins when no flag/env (priority 3)', () => {
    writeToolsSwitch('none');
    expect(resolveToolsKind({})).toBe('none');
  });

  test('switch readonly takes effect', () => {
    writeToolsSwitch('readonly');
    expect(resolveToolsKind({})).toBe('readonly');
  });

  test('switch webterm takes effect', () => {
    writeToolsSwitch('webterm');
    expect(resolveToolsKind({})).toBe('webterm');
  });

  test('preserves `chat` from CLI over lower-priority env and switch inputs', () => {
    process.env.MONAD_TOOLS = 'readonly';
    writeToolsSwitch('none');
    expect(resolveToolsKind({ tools: 'chat' })).toBe('chat');
  });

  test('preserves `chat` from MONAD_TOOLS when no CLI flag is given', () => {
    process.env.MONAD_TOOLS = 'chat';
    writeToolsSwitch('none');
    expect(resolveToolsKind({})).toBe('chat');
  });

  test('preserves `chat` from the global.tools switch when no higher-priority input is given', () => {
    writeToolsSwitch('chat');
    expect(resolveToolsKind({})).toBe('chat');
  });

  test('"all" (enum-listed but unimpl) → webterm fallback', () => {
    expect(resolveToolsKind({ tools: 'all' })).toBe('webterm');
  });

  test('unknown string → webterm fallback (graceful)', () => {
    expect(resolveToolsKind({ tools: 'gibberish' })).toBe('webterm');
  });

  test('empty flag falls through to env / switch / default', () => {
    process.env.MONAD_TOOLS = 'readonly';
    expect(resolveToolsKind({ tools: '' })).toBe('readonly');
  });

  test('malformed config does not throw — falls through to default', () => {
    mkdirSync(tmpRoot, { recursive: true });
    writeFileSync(userConfigPath(), '{ this is not json');
    expect(() => resolveToolsKind({})).not.toThrow();
    expect(resolveToolsKind({})).toBe('webterm');
  });
});

const validToolsKinds = ['readonly', 'webterm', 'chat', 'none'] as const;

describe('tool-kind resolvers — valid CLI input parity', () => {
  for (const kind of validToolsKinds) {
    test(`both resolvers preserve \`${kind}\``, () => {
      expect(resolveToolsKind({ tools: kind })).toBe(kind);
      expect(resolveAgentTurnToolsKind({ tools: kind })).toBe(kind);
    });
  }
});

// resolveAgentTurnToolsKind — `:agent` (통합 모드 webterm dock) 전용
// resolver. user-config / env 무시; CLI flag 만 존중. WebTerminal*
// tools 가 통합 모드의 본질이므로 user 가 global.tools 를 narrow 해도
// 통합 모드는 영향을 받지 않아야 한다.
describe('resolveAgentTurnToolsKind — user-config bypass + CLI honor', () => {
  test('clean — no flag → webterm', () => {
    expect(resolveAgentTurnToolsKind({})).toBe('webterm');
  });

  test('user-config `chat` is IGNORED → webterm', () => {
    writeToolsSwitch('chat');
    expect(resolveAgentTurnToolsKind({})).toBe('webterm');
  });

  test('user-config `readonly` is IGNORED → webterm', () => {
    writeToolsSwitch('readonly');
    expect(resolveAgentTurnToolsKind({})).toBe('webterm');
  });

  test('user-config `none` is IGNORED → webterm (this is the integrated-mode contract)', () => {
    writeToolsSwitch('none');
    expect(resolveAgentTurnToolsKind({})).toBe('webterm');
  });

  test('MONAD_TOOLS env is IGNORED → webterm', () => {
    process.env.MONAD_TOOLS = 'readonly';
    expect(resolveAgentTurnToolsKind({})).toBe('webterm');
  });

  test.each(['readonly', 'chat', 'webterm', 'none'] as const)(
    'CLI flag `%s` is honored',
    (kind) => {
      writeToolsSwitch('chat');
      process.env.MONAD_TOOLS = 'readonly';
      expect(resolveAgentTurnToolsKind({ tools: kind })).toBe(kind);
    },
  );

  test('CLI flag `all` (unimpl enum) → webterm fallback', () => {
    expect(resolveAgentTurnToolsKind({ tools: 'all' })).toBe('webterm');
  });

  test('CLI flag unknown string → webterm fallback', () => {
    expect(resolveAgentTurnToolsKind({ tools: 'bogus' })).toBe('webterm');
  });

  test('empty CLI flag falls through to webterm (env/config still ignored)', () => {
    process.env.MONAD_TOOLS = 'readonly';
    writeToolsSwitch('readonly');
    expect(resolveAgentTurnToolsKind({ tools: '' })).toBe('webterm');
  });

  test('whitespace-only CLI flag falls through to webterm', () => {
    expect(resolveAgentTurnToolsKind({ tools: '   ' })).toBe('webterm');
  });
});
