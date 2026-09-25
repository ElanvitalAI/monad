// Slash focus budget — `/cc`·/cdx·/gem 타겟 명령에 tight 예산 지시어 주입.
//
// 컨셉: 말로(NL) = 여유(브레인 maxTurns) · 슬래시(타겟) = 타이트(sub-agent에
// soft 예산 지시어). buildSlashFocusPreamble 순수 검증 + runAcpTurn 이
// focusTurns 지정 시 프롬프트에 프리앰블을 prepend 하는지(미지정 시 안 함) 확인.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildSlashFocusPreamble,
  SLASH_FOCUS_TURNS_DEFAULT,
  runAcpTurn,
  _resetTurnRunnerCachesForTests,
} from '../src/acp/turn-runner';
import { _resetAcpSessionStoreForTests } from '../src/acp/session-store.js';
import { _resetAcpAgentManagerForTests } from '../src/acp/agent-manager.js';

describe('buildSlashFocusPreamble', () => {
  test('carries the turn budget + focus directive + task marker', () => {
    const p = buildSlashFocusPreamble(8);
    expect(p).toContain('8');
    expect(p).toContain('집중');
    expect(p).toContain('재독'); // "파일 재독을 피하고"
    expect(p.trimEnd().endsWith('작업:')).toBe(true);
  });
  test('default constant is 8', () => {
    expect(SLASH_FOCUS_TURNS_DEFAULT).toBe(8);
  });
});

/** Stub agent capturing the prompt blocks passed to agent.prompt. */
function installPromptCapturingAgent(): { blocks: unknown } {
  const captured: { blocks: unknown } = { blocks: null };
  _resetAcpAgentManagerForTests();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../src/acp/agent-manager.js') as { globalAcpAgentManager: () => Record<string, unknown> };
  const live = mod.globalAcpAgentManager();
  const stub = {
    getCapabilities: () => ({ loadSession: false }),
    newSession: async () => 'sess-focus',
    loadSession: async () => { /* unused */ },
    async prompt(_sid: unknown, blocks: unknown) { captured.blocks = blocks; return { stopReason: 'end_turn' }; },
    cancel: async () => { /* noop */ },
  };
  live['getAgent'] = async () => stub as unknown;
  live['drop'] = () => { /* noop */ };
  return captured;
}

describe('runAcpTurn · focusTurns preamble injection', () => {
  const ORIGINAL_XDG = process.env.XDG_CONFIG_HOME;
  let dir: string | null = null;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'slash-focus-'));
    process.env.XDG_CONFIG_HOME = dir;
    _resetTurnRunnerCachesForTests();
    _resetAcpSessionStoreForTests();
  });
  afterEach(() => {
    _resetTurnRunnerCachesForTests();
    _resetAcpSessionStoreForTests();
    if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } dir = null; }
    if (ORIGINAL_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = ORIGINAL_XDG;
  });

  test('focusTurns set → prompt is prefixed with the focus preamble', async () => {
    const captured = installPromptCapturingAgent();
    await runAcpTurn({ backendId: 'claude', promptText: 'refactor the parser', chatId: 1, focusTurns: 8 });
    const blob = JSON.stringify(captured.blocks);
    expect(blob).toContain('집중 모드');
    expect(blob).toContain('refactor the parser');
  });

  test('no focusTurns → prompt is verbatim (NL path stays generous)', async () => {
    const captured = installPromptCapturingAgent();
    await runAcpTurn({ backendId: 'claude', promptText: 'just chat', chatId: 2 });
    const blob = JSON.stringify(captured.blocks);
    expect(blob).not.toContain('집중 모드');
    expect(blob).toContain('just chat');
  });
});
