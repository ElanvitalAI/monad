// NEXUS · webterm 탭 default-OFF (PWA mirror prep cleanup)
//
// PR PWA-mirror-0 의 회귀 가드. webterm 탭이 default 로 register 되지
// 않고, switch / env 로 opt-in 가능한지 검증.
//
// 배경: TUI 의 webterm placeholder 는 ANSI parser 미연결 + Ctrl-arrow
// 충돌 + multi-session picker 미존재로 사람이 직접 인터랙션하기엔
// placeholder 수준. 외부 터미널을 1급 surface 로 두는 게 desktop
// 사용자에게 합당. LLM tool surface (--tools webterm) 는 본 switch
// 와 무관 — 탭 register 와 LLM 도구 catalog 는 직교.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runNexus } from '../src/nexus/index.js';
import { userConfigPath } from '../src/nexus/config/paths.js';
import {
  clearSwitchRegistry,
} from '../src/nexus/config/switch-registry.js';
import { reloadAllBuiltins } from '../src/nexus/config/builtins/index.js';
import { USER_CONFIG_VERSION } from '../src/nexus/config/types.js';
import { setMonadConfigDir, resetMonadConfigDir } from '../src/monad-config-dir.js';

let tmpRoot: string;
let prevNexus: string | undefined;
let prevReg: string | undefined;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'monad-nexus-webterm-toggle-'));
  prevNexus = process.env.MONAD_NEXUS_DIR;
  prevReg = process.env.MONAD_REGISTER_WEBTERM;
  // Isolate both UserConfig (via setMonadConfigDir) and NEXUS root
  // (MONAD_NEXUS_DIR · lock + runtime.json) so the host's live nexus
  // process can't collide with the test boot.
  setMonadConfigDir(tmpRoot);
  process.env.MONAD_NEXUS_DIR = join(tmpRoot, 'nexus');
  delete process.env.MONAD_REGISTER_WEBTERM;
  clearSwitchRegistry();
  reloadAllBuiltins();
});

afterEach(() => {
  resetMonadConfigDir();
  if (prevNexus === undefined) delete process.env.MONAD_NEXUS_DIR;
  else process.env.MONAD_NEXUS_DIR = prevNexus;
  if (prevReg === undefined) delete process.env.MONAD_REGISTER_WEBTERM;
  else process.env.MONAD_REGISTER_WEBTERM = prevReg;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  clearSwitchRegistry();
});

function bootDetached() {
  // detachForTesting=true · skipRuntimeApi=true so the runtime stays
  // synchronous + no http-server / acp-server lifecycle gets spun up.
  // We only need the registered TabRegistry snapshot.
  return runNexus({
    detachForTesting: true,
    skipRuntimeApi: true,
    skipSupervisor: true,
  });
}

function writeSwitchValue(value: boolean): void {
  mkdirSync(tmpRoot, { recursive: true });
  writeFileSync(
    userConfigPath(),
    JSON.stringify({
      version: USER_CONFIG_VERSION,
      global: { tabs: { registerWebterm: value } },
      tabs: {},
    }),
  );
}

describe('webterm tab default-OFF', () => {
  test('default — no env, no switch → webterm:1 NOT registered', async () => {
    const handle = await bootDetached();
    const ids = handle!.registry.list().map((t) => t.spec.id);
    expect(ids).toContain('chat:1');
    expect(ids).not.toContain('webterm:1');
    handle!.release();
  });

  test('MONAD_REGISTER_WEBTERM=1 → webterm:1 registered', async () => {
    process.env.MONAD_REGISTER_WEBTERM = '1';
    const handle = await bootDetached();
    const ids = handle!.registry.list().map((t) => t.spec.id);
    expect(ids).toContain('webterm:1');
    handle!.release();
  });

  test('MONAD_REGISTER_WEBTERM=true → webterm:1 registered', async () => {
    process.env.MONAD_REGISTER_WEBTERM = 'true';
    const handle = await bootDetached();
    const ids = handle!.registry.list().map((t) => t.spec.id);
    expect(ids).toContain('webterm:1');
    handle!.release();
  });

  test('MONAD_REGISTER_WEBTERM=0 (or any falsy non-truthy) → NOT registered', async () => {
    process.env.MONAD_REGISTER_WEBTERM = '0';
    const handle = await bootDetached();
    const ids = handle!.registry.list().map((t) => t.spec.id);
    expect(ids).not.toContain('webterm:1');
    handle!.release();
  });

  test('switch true → registered (env unset)', async () => {
    writeSwitchValue(true);
    const handle = await bootDetached();
    const ids = handle!.registry.list().map((t) => t.spec.id);
    expect(ids).toContain('webterm:1');
    handle!.release();
  });

  test('switch false → NOT registered (overrides env truthy)', async () => {
    writeSwitchValue(false);
    process.env.MONAD_REGISTER_WEBTERM = '1';
    const handle = await bootDetached();
    const ids = handle!.registry.list().map((t) => t.spec.id);
    // Switch wins over env per resolution order (switch is the SSoT).
    expect(ids).not.toContain('webterm:1');
    handle!.release();
  });
});
