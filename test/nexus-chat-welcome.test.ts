// NEXUS · first-boot welcome card (N-1 cleanup PR g.3) — unit tests.
//
// shouldShowWelcome / dismissWelcome / buildWelcomeCardLines
// + chat-tab view integration (welcome above guidance when
// backend='none' + flag unset).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  buildWelcomeCardLines,
  dismissWelcome,
  shouldShowWelcome,
  shouldShowWelcomeNow,
} from '../src/nexus/chat/welcome.js';
import { Printer } from '../src/ui/printer.js';
import { createChatTabSpec, createChatTabView } from '../src/nexus/kinds/chat.js';
import { NexusChatSession } from '../src/nexus/chat/session.js';
import {
  USER_CONFIG_VERSION,
  type UserConfig,
} from '../src/nexus/config/types.js';
import { readUserConfig } from '../src/nexus/config/user-config.js';
import { setMonadConfigDir, resetMonadConfigDir } from '../src/monad-config-dir.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(joinPath(tmpdir(), 'monad-nexus-welcome-'));
  // userConfigPath() resolves under setMonadConfigDir; override so
  // the test never touches the developer's real ~/.monad/config.json.
  setMonadConfigDir(tmpRoot);
});

afterEach(() => {
  resetMonadConfigDir();
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* swallow */ }
});

function emptyCfg(): UserConfig {
  return { version: USER_CONFIG_VERSION, global: {}, tabs: {} };
}

describe('shouldShowWelcome · pure read', () => {
  test('flag unset → true (new user)', () => {
    expect(shouldShowWelcome(emptyCfg())).toBe(true);
  });

  test('flag === false → true (treated like unset)', () => {
    const cfg = emptyCfg();
    cfg.global.nexus = { firstBootGuideShown: false };
    expect(shouldShowWelcome(cfg)).toBe(true);
  });

  test('flag === true → false (dismissed already)', () => {
    const cfg = emptyCfg();
    cfg.global.nexus = { firstBootGuideShown: true };
    expect(shouldShowWelcome(cfg)).toBe(false);
  });
});

describe('dismissWelcome · disk persistence', () => {
  test('first call writes flag=true; subsequent reads see it', () => {
    expect(shouldShowWelcomeNow()).toBe(true);
    dismissWelcome();
    expect(shouldShowWelcomeNow()).toBe(false);
    const cfg = readUserConfig();
    expect(cfg.global.nexus?.firstBootGuideShown).toBe(true);
  });

  test('idempotent — second call writes the same value', () => {
    dismissWelcome();
    dismissWelcome();
    const cfg = readUserConfig();
    expect(cfg.global.nexus?.firstBootGuideShown).toBe(true);
  });

  test('preserves other nexus.* fields when patching', () => {
    // Simulate a config that already has template/autoRestart set.
    const { writeUserConfig } = require('../src/nexus/config/user-config.js');
    const cfg = emptyCfg();
    cfg.global.nexus = { autoRestartOnConfigChange: false, template: 'demo' };
    writeUserConfig(cfg);
    dismissWelcome();
    const after = readUserConfig();
    expect(after.global.nexus?.firstBootGuideShown).toBe(true);
    expect(after.global.nexus?.autoRestartOnConfigChange).toBe(false);
    expect(after.global.nexus?.template).toBe('demo');
  });
});

describe('buildWelcomeCardLines · copy', () => {
  test('mentions NEXUS, Settings, the `monad` dashboard entry, Esc', () => {
    const lines = buildWelcomeCardLines();
    const joined = lines.join('\n');
    expect(joined).toContain('Welcome to monad NEXUS');
    expect(joined).toContain('Settings 탭');
    // Points to the interactive dashboard entry (no longer `monad legacy`).
    expect(joined).toContain('`monad`');
    expect(joined).toContain('Esc');
  });

  test('lists 3 provider entries (codex / claude / gemini env hints)', () => {
    const lines = buildWelcomeCardLines();
    const joined = lines.join('\n');
    expect(joined).toContain('OPENAI_API_KEY');
    expect(joined).toContain('ANTHROPIC_API_KEY');
    expect(joined).toContain('GEMINI_API_KEY');
  });
});

describe('chat tab view integration · welcome card visibility', () => {
  function renderInert(): string {
    const sess = new NexusChatSession({ backend: 'none' });
    const spec = createChatTabSpec({ id: 'chat:1' });
    const view = createChatTabView(spec, sess);
    const p = Printer.create({ width: 80, height: 30, focused: true });
    view.layout({ width: 80, height: 30 });
    view.draw(p);
    return p.lines().join('\n');
  }

  test('flag unset → welcome card visible above the no-backend guidance', () => {
    // tmpRoot is fresh; flag is unset.
    const out = renderInert();
    expect(out).toContain('Welcome to monad NEXUS');
    // Also still shows the per-PR-g.1 guidance (3 provider entries).
    expect(out).toContain('No chat backend configured');
    // Welcome appears before guidance.
    const welcomeIdx = out.indexOf('Welcome to monad NEXUS');
    const guideIdx = out.indexOf('No chat backend configured');
    expect(welcomeIdx).toBeLessThan(guideIdx);
  });

  test('flag set → welcome card omitted, guidance still visible', () => {
    dismissWelcome();
    const out = renderInert();
    expect(out).toContain('No chat backend configured');
    expect(out).not.toContain('Welcome to monad NEXUS');
  });
});
