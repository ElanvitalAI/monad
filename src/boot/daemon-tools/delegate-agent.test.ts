// 위임 게이트 규율 가드(대표 결정 2026-07-14) — 명시 지목 없으면 직접 코딩.
// 프롬프트 문자열 계약이라 회귀가 조용히 일어나기 쉬워 배선 가드로 고정.
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { globalDualRoleManager } from '../../acp/dual-role-manager.js';
import { elanousSelfAccessPrompt } from '../../agent/self-ambient.js';
import { debug } from '../../debug/log.js';
import { buildDelegateAgentTool, DELEGATE_BACKENDS, dispatchDelegateAgent } from './delegate-agent.js';
import type { DaemonToolDispatchCtx } from './types.js';

const cwd = '/tmp/delegate-agent-observability-test';
const task = 'sensitive delegated task body';
const output = 'sensitive delegated output body';

function ctx(): DaemonToolDispatchCtx {
  return { cwd, signal: new AbortController().signal };
}

function fakeAgent(promptImpl: (onUpdate: (update: unknown) => void) => Promise<{ stopReason: string }>) {
  return {
    newSession: mock(async () => 'delegate-test-session'),
    prompt: mock(async (_sessionId: string, _blocks: unknown, onUpdate: (update: unknown) => void) => promptImpl(onUpdate)),
    cancel: mock(async () => {}),
  };
}

beforeEach(() => {
  debug.clear();
  const manager = globalDualRoleManager();
  manager.__clearForTest();
});

afterEach(() => {
  const manager = globalDualRoleManager();
  manager.__setAgentFactoryForTest(null);
  manager.__clearForTest();
  debug.clear();
});

describe('delegate_code_agent — 명시 지목시에만 위임(대표 결정 2026-07-14)', () => {
  test('도구 설명 — 명시 지목 조건 + 재량 위임 금지 문구', () => {
    const desc = buildDelegateAgentTool().description;
    expect(desc).toContain('명시 지목한 경우에만');
    expect(desc).toContain('재량으로 backend 를 골라 위임하지 마라');
  });

  test('자기접근 규율 — 지목 없으면 크기 무관 직접 코딩', () => {
    const p = elanousSelfAccessPrompt();
    expect(p).toContain('직접 코딩하라');
    expect(p).toContain('명시 지목했을 때만');
  });

  test('backend enum 불변(claude/codex-app-server/gemini/grok)', () => {
    expect([...DELEGATE_BACKENDS]).toEqual(['claude', 'codex-app-server', 'gemini', 'grok']);
  });

  // ⭐ 2026-08-11(대표 승인) — 새 기본 계약을 «문구»로 고정한다. ⛔ 왜 필요한가: 종전 문면
  //   *"소스 수정 요청: 크기와 무관하게 … 직접 코딩하라"* 가 대표 결정의 «대상이 아니던» 하니스까지
  //   눌렀고, 그것이 「자연어 개발 요청이 하니스로 안 간다」의 프롬프트 층 원인이었다.
  //   이 가드가 없으면 같은 문장이 조용히 되돌아온다(리뷰 should-fix).
  test('자기접근 규율 — 소스 수정의 «기본»이 하니스이고, 직접 편집은 «작은 것»으로 남는다', () => {
    const p = elanousSelfAccessPrompt();
    // ① 기본값이 하니스라고 «말한다»
    expect(p).toContain('기본은 하니스다');
    expect(p).toContain('SelfImplement/RunDevHarness');
    // ② 직접 편집이 「크기 무관」이 아니라 «작은 것»에 걸린다
    expect(p).toContain('한 줄 수정·설정값·문서처럼 작은 것');
    expect(p).not.toContain('크기와 무관하게');
    // ③ ⛔ 원 결정이 막던 축은 그대로다
    expect(p).toContain('명시 지목했을 때만');
    expect(p).toContain('재량으로 backend 를 골라');
  });

  test('도구 설명 — 지목 없을 때의 «대안»이 하니스로 명시된다', () => {
    const desc = buildDelegateAgentTool().description;
    expect(desc).toContain('SelfImplement/RunDevHarness');
    expect(desc).not.toContain('작업 크기와 무관하게');
  });
});

describe('dispatchDelegateAgent observability boundaries', () => {
  test('logs delegate start and finish with metadata lengths but not task or output bodies', async () => {
    globalDualRoleManager().__setAgentFactoryForTest(async () => fakeAgent(async onUpdate => {
      onUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: output } });
      return { stopReason: 'end_turn' };
    }) as any);

    await dispatchDelegateAgent({ backend: 'claude', task }, ctx());

    const events = debug.events().filter(event => event.event === 'delegate' || event.event === 'delegate-finish');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ category: 'agent.spawn', event: 'delegate', data: { backend: 'claude', cwd, taskChars: task.length } });
    expect(events[1]).toMatchObject({ category: 'agent.done', event: 'delegate-finish', data: { backend: 'claude', cwd, taskChars: task.length, outputChars: output.length } });
    expect(JSON.stringify(events)).not.toContain(task);
    expect(JSON.stringify(events)).not.toContain(output);
  });

  test('logs a safe failure reason and metadata lengths without error-embedded task or output bodies', async () => {
    globalDualRoleManager().__setAgentFactoryForTest(async () => fakeAgent(async () => {
      throw new Error(`delegation transport failed: ${task}; ${output}`);
    }) as any);

    await dispatchDelegateAgent({ backend: 'claude', task }, ctx());

    const failed = debug.events().find(event => event.category === 'agent.error' && event.event === 'delegate-failed');
    expect(failed).toMatchObject({
      data: { backend: 'claude', cwd, taskChars: task.length, outputChars: 0, reason: 'delegate-send-failed' },
    });
    expect(JSON.stringify(failed)).not.toContain(task);
    expect(JSON.stringify(failed)).not.toContain(output);
  });
});
