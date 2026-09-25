// NEXUS · chat backend resolver (N-1 cleanup PR a) — unit tests.
//
// Pin the resolver fall-through (override → per-tab → global → hard
// default) + the SwitchSpec contract for `global.chat.defaultBackend`
// and `tabs.chat:<id>.backend`.

import { describe, expect, test } from 'bun:test';

import {
  CHAT_BACKEND_HARD_DEFAULT,
  isChatBackendDisabled,
  resolveChatBackend,
} from '../src/nexus/chat/backend-resolver.js';
import {
  CHAT_DEFAULT_BACKEND_SWITCH_ID,
  CHAT_SWITCHES,
  CHAT_TAB_BACKEND_SWITCH_ID,
  isChatBackendKind,
} from '../src/nexus/config/builtins/tab-chat.js';
import {
  createChatTabSpec,
  readChatTabBackend,
} from '../src/nexus/kinds/chat.js';
import {
  USER_CONFIG_VERSION,
  type UserConfig,
} from '../src/nexus/config/types.js';
import { writeSwitchValue } from '../src/nexus/config/user-config.js';
import {
  CHAT_SWITCHES as RE_CHAT_SWITCHES,
  GLOBAL_SWITCHES,
  reloadAllBuiltins,
} from '../src/nexus/config/builtins/index.js';
import {
  clearSwitchRegistry,
  getSwitch,
  listSwitches,
} from '../src/nexus/config/switch-registry.js';

function emptyCfg(): UserConfig {
  return { version: USER_CONFIG_VERSION, global: {}, tabs: {} };
}

describe('chat backend resolver (N-1 cleanup PR a)', () => {
  describe('resolveChatBackend fall-through', () => {
    test('hard default when no config / no override', () => {
      const cfg = emptyCfg();
      // PR g.1 — hard default flipped 'claude-code' → 'none' so a
      // clean machine surfaces the Quick Setup placeholder instead of
      // a silent ACP-spawn fail. Boot-time auto-detection (run by
      // runNexus) tries env-var / OAuth-token wiring before we ever
      // hit the placeholder; this test only pins the static fallback.
      expect(resolveChatBackend({ cfg, tabId: 'chat:1' })).toBe('none');
      expect(CHAT_BACKEND_HARD_DEFAULT).toBe('none');
    });

    test('override wins over every config layer', () => {
      const cfg = emptyCfg();
      writeSwitchValue(cfg, CHAT_DEFAULT_BACKEND_SWITCH_ID, 'codex');
      writeSwitchValue(cfg, 'tabs.chat:1.backend', 'none');
      const got = resolveChatBackend({ cfg, tabId: 'chat:1', override: 'claude-code' });
      expect(got).toBe('claude-code');
    });

    test('per-tab override wins over global default', () => {
      const cfg = emptyCfg();
      writeSwitchValue(cfg, CHAT_DEFAULT_BACKEND_SWITCH_ID, 'codex');
      writeSwitchValue(cfg, 'tabs.chat:7.backend', 'none');
      expect(resolveChatBackend({ cfg, tabId: 'chat:7' })).toBe('none');
    });

    test('empty per-tab override falls through to global', () => {
      const cfg = emptyCfg();
      writeSwitchValue(cfg, CHAT_DEFAULT_BACKEND_SWITCH_ID, 'codex');
      writeSwitchValue(cfg, 'tabs.chat:1.backend', '');
      expect(resolveChatBackend({ cfg, tabId: 'chat:1' })).toBe('codex');
    });

    test('global default applied when per-tab not set', () => {
      const cfg = emptyCfg();
      writeSwitchValue(cfg, CHAT_DEFAULT_BACKEND_SWITCH_ID, 'codex');
      expect(resolveChatBackend({ cfg, tabId: 'chat:1' })).toBe('codex');
    });

    test('malformed override falls through (corrupt UserConfig safe)', () => {
      const cfg = emptyCfg();
      // writeSwitchValue does not validate — simulate a corrupt blob
      // that survived a manual edit. resolver must fall through to
      // the PR g.1 hard default ('none').
      writeSwitchValue(cfg, CHAT_DEFAULT_BACKEND_SWITCH_ID, 'banana-llm');
      expect(resolveChatBackend({ cfg, tabId: 'chat:1' })).toBe('none');
    });
  });

  describe('isChatBackendKind / isChatBackendDisabled', () => {
    test('isChatBackendKind accepts the 4 canonical values only', () => {
      // PR g.1 — added 'gemini' to the enum so the gemini-cli ACP
      // wrap (already in dashboard ACP_BACKENDS) becomes selectable
      // from the NEXUS chat surface.
      for (const v of ['claude-code', 'codex', 'gemini', 'none']) {
        expect(isChatBackendKind(v)).toBe(true);
      }
      for (const v of ['CLAUDE-CODE', '', null, undefined, 42, {}]) {
        expect(isChatBackendKind(v)).toBe(false);
      }
    });

    test('isChatBackendDisabled true only for none', () => {
      expect(isChatBackendDisabled('none')).toBe(true);
      expect(isChatBackendDisabled('claude-code')).toBe(false);
      expect(isChatBackendDisabled('codex')).toBe(false);
      expect(isChatBackendDisabled('gemini')).toBe(false);
    });
  });
});

describe('tab-chat builtin switches', () => {
  test('CHAT_SWITCHES exports both ids with sane defaults', () => {
    const ids = new Set(CHAT_SWITCHES.map((s) => s.id));
    expect(ids.has(CHAT_DEFAULT_BACKEND_SWITCH_ID)).toBe(true);
    expect(ids.has(CHAT_TAB_BACKEND_SWITCH_ID)).toBe(true);
    const def = CHAT_SWITCHES.find((s) => s.id === CHAT_DEFAULT_BACKEND_SWITCH_ID)!;
    expect(def.kind).toBe('enum');
    // PR g.1 — default flipped 'claude-code' → 'none'.
    expect(def.default).toBe('none');
    expect(def.hotApplicable).toBe(false);
    expect(def.restartTabs).toEqual([]);
    const perTab = CHAT_SWITCHES.find((s) => s.id === CHAT_TAB_BACKEND_SWITCH_ID)!;
    expect(perTab.scope).toBe('tab');
    expect(perTab.appliesTo).toEqual(['chat']);
    expect(perTab.default).toBe('');
    // per-tab restart so the chat:1 surface re-resolves on change.
    expect(perTab.restartTabs).toEqual(['chat:1']);
  });

  test('SwitchSpec.validate rejects invalid values', () => {
    const def = CHAT_SWITCHES.find((s) => s.id === CHAT_DEFAULT_BACKEND_SWITCH_ID)!;
    expect(def.validate?.('claude-code')).toBeNull();
    expect(def.validate?.('codex')).toBeNull();
    // PR g.1 — 'gemini' is now a valid value.
    expect(def.validate?.('gemini')).toBeNull();
    expect(def.validate?.('none')).toBeNull();
    expect(def.validate?.('banana-llm')).toBe('must be one of claude-code|codex|gemini|none');
    const perTab = CHAT_SWITCHES.find((s) => s.id === CHAT_TAB_BACKEND_SWITCH_ID)!;
    expect(perTab.validate?.('')).toBeNull();
    expect(perTab.validate?.('codex')).toBeNull();
    expect(perTab.validate?.('gemini')).toBeNull();
    expect(perTab.validate?.('banana-llm')).toBe('must be empty or one of claude-code|codex|gemini|none');
  });

  test('reloadAllBuiltins registers chat switches alongside the existing 5 packs', () => {
    clearSwitchRegistry();
    reloadAllBuiltins();
    const ids = new Set(listSwitches().map((s) => s.id));
    // chat (PR a)
    expect(ids.has(CHAT_DEFAULT_BACKEND_SWITCH_ID)).toBe(true);
    expect(ids.has(CHAT_TAB_BACKEND_SWITCH_ID)).toBe(true);
    // sanity: existing packs survived the reload
    expect(ids.has('global.tools')).toBe(true);
    expect(ids.has('tabs.daemon:1.tools')).toBe(true);
    // PR g.1 — registered default reflects the flipped hard default.
    expect(getSwitch(CHAT_DEFAULT_BACKEND_SWITCH_ID)?.default).toBe('none');
    expect(GLOBAL_SWITCHES.length).toBeGreaterThan(0);
    expect(RE_CHAT_SWITCHES.length).toBe(2);
  });
});

describe('createChatTabSpec records resolved backend', () => {
  test('explicit backend wins over UserConfig', () => {
    const cfg = emptyCfg();
    writeSwitchValue(cfg, CHAT_DEFAULT_BACKEND_SWITCH_ID, 'codex');
    const spec = createChatTabSpec({ id: 'chat:1', userConfig: cfg, backend: 'none' });
    expect(readChatTabBackend(spec)).toBe('none');
  });

  test('falls back to UserConfig switch when backend omitted', () => {
    const cfg = emptyCfg();
    writeSwitchValue(cfg, CHAT_DEFAULT_BACKEND_SWITCH_ID, 'codex');
    const spec = createChatTabSpec({ id: 'chat:1', userConfig: cfg });
    expect(readChatTabBackend(spec)).toBe('codex');
  });

  test('falls back to hard default when nothing set', () => {
    // PR g.1 — flipped 'claude-code' → 'none'. runNexus boot wire
    // applies auto-detection on top so a clean-machine env-var user
    // still gets a wired backend; the spec-time fallback is just the
    // floor.
    const cfg = emptyCfg();
    const spec = createChatTabSpec({ id: 'chat:1', userConfig: cfg });
    expect(readChatTabBackend(spec)).toBe('none');
  });

  test('preserves resumeSessionId alongside backend in meta', () => {
    const cfg = emptyCfg();
    const spec = createChatTabSpec({
      id: 'chat:7',
      userConfig: cfg,
      resumeSessionId: 'sess-abc',
    });
    expect((spec.meta as { resumeSessionId?: string }).resumeSessionId).toBe('sess-abc');
    expect(readChatTabBackend(spec)).toBe('none');
  });

  test('readChatTabBackend tolerates legacy specs (no meta.backend)', () => {
    const legacy = { id: 'chat:1', kind: 'chat', label: 'chat:1' } as never;
    expect(readChatTabBackend(legacy)).toBe('none');
  });
});
