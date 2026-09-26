// NEXUS · welcome card dismiss flag <-> switch interop (PWA mirror PR 4)
//
// The new `global.nexus.firstBootGuideShown` switch is a switch
// surface for the same UserConfig field that `chat/welcome.ts`'s
// `dismissWelcome()` already writes. PWA writes via PUT /v1/config/
// switches/:id (generic), TUI writes via dismissWelcome() (chat path).
// Both routes must converge on the same field so the dismiss state
// is shared single-source.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readUserConfig,
  writeUserConfig,
  readSwitchValue,
  writeSwitchValue,
} from '../src/nexus/config/user-config.js';
import { getSwitch } from '../src/nexus/config/switch-registry.js';
import { reloadAllBuiltins } from '../src/nexus/config/builtins/index.js';
import { clearSwitchRegistry } from '../src/nexus/config/switch-registry.js';
import {
  dismissWelcome,
  shouldShowWelcome,
} from '../src/nexus/chat/welcome.js';
import { setElanousConfigDir, resetElanousConfigDir } from '../src/elanous-config-dir.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'elanous-nexus-welcome-switch-'));
  setElanousConfigDir(tmpRoot);
  clearSwitchRegistry();
  reloadAllBuiltins();
});

afterEach(() => {
  resetElanousConfigDir();
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  clearSwitchRegistry();
});

const SWITCH_ID = 'global.nexus.firstBootGuideShown';

describe('global.nexus.firstBootGuideShown switch — PWA mirror PR 4', () => {
  test('switch is registered after reloadAllBuiltins', () => {
    const sw = getSwitch(SWITCH_ID);
    expect(sw).toBeDefined();
    expect(sw!.kind).toBe('bool');
    expect(sw!.default).toBe(false);
    expect(sw!.scope).toBe('global');
    expect(sw!.pwaPreferred).toBe(true);
  });

  test('switch path resolves to cfg.global.nexus.firstBootGuideShown', () => {
    const cfg = readUserConfig();
    expect(readSwitchValue(cfg, SWITCH_ID)).toBeUndefined();
  });

  test('writeSwitchValue flips the same field that dismissWelcome writes', () => {
    // Write via switch path
    const cfg = readUserConfig();
    writeSwitchValue(cfg, SWITCH_ID, true);
    writeUserConfig(cfg);
    // Read back via the welcome.ts function
    expect(shouldShowWelcome(readUserConfig())).toBe(false);
  });

  test('dismissWelcome and switch read converge', () => {
    expect(shouldShowWelcome(readUserConfig())).toBe(true);
    dismissWelcome();
    // After dismissWelcome the switch read should also report true
    expect(readSwitchValue(readUserConfig(), SWITCH_ID)).toBe(true);
  });

  test('toggling the switch back to false re-shows the card', () => {
    dismissWelcome();
    expect(shouldShowWelcome(readUserConfig())).toBe(false);
    // Switch flip back
    const cfg = readUserConfig();
    writeSwitchValue(cfg, SWITCH_ID, false);
    writeUserConfig(cfg);
    expect(shouldShowWelcome(readUserConfig())).toBe(true);
  });

  test('switch validate rejects non-boolean', () => {
    const sw = getSwitch(SWITCH_ID);
    expect(sw!.validate!('truthy')).toBe('must be boolean');
    expect(sw!.validate!(1)).toBe('must be boolean');
    expect(sw!.validate!(false)).toBeNull();
    expect(sw!.validate!(true)).toBeNull();
  });
});
