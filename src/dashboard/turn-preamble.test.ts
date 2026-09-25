// TUI 턴 preamble — monad 자기접근 규율 주입 계약 (P3 · 2026-07-13).
// 텔레그램(makeMonadAgentRunTurn)과 단일 출처(agent/self-ambient.ts)의 규율이 TUI 채팅
// systemPrompt 에도 실리는지 — 3박자(툴·기억·규율) 중 '규율' 축의 표면 패리티.
import { test, expect, describe } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildControllerSystemMessage, buildDashboardTurnPreamble } from './turn-preamble.js';
import { globalTaskNotificationQueue } from '../agent/task-notification.js';
import type { getUserConfig } from '../user-config.js';

const fakeConfig = { chat: { conciseness: 'balanced' } } as unknown as ReturnType<typeof getUserConfig>;

describe('buildDashboardTurnPreamble — 제어 표면', () => {
  const build = (controlEnv?: { controller?: string; channels?: string }) => buildDashboardTurnPreamble({
    userText: 'continue',
    cwd: mkdtempSync(join(tmpdir(), 'preamble-controller-')),
    userConfig: fakeConfig,
    ...(controlEnv !== undefined ? { controlEnv } : {}),
  });

  test('builds the exact controller system-message paragraph', () => {
    expect(buildControllerSystemMessage('pty:pty_abcd1234', 'pty,inbox')).toEqual({
      role: 'system',
      content: '[제어 표면] 이 모나드 세션은 밖의 제어자 pty:pty_abcd1234 가 몰고 있다. 열린 관: pty,inbox. 감독 메모로 들어온 지시는 이 제어자의 지시다. PTY 로 들어오는 입력도 사람이 아니라 이 제어자가 넣은 것일 수 있다.',
    });
  });

  test('injected controller and channels produce exactly one controller system message', () => {
    const messages = build({ controller: 'pty:pty_abcd1234', channels: 'pty,inbox' });
    const controllerMessages = messages.filter((message) => message.role === 'system'
      && String(message.content).includes('[제어 표면]'));

    expect(controllerMessages).toHaveLength(1);
    expect(controllerMessages[0]?.content).toContain('pty:pty_abcd1234');
    expect(controllerMessages[0]?.content).toContain('pty,inbox');
  });

  test('injected controller defaults its channel to pty', () => {
    const messages = build({ controller: 'agent:claude-code' });
    const controllerMessage = messages.find((message) => String(message.content).includes('[제어 표면]'));

    expect(controllerMessage?.content).toContain('열린 관: pty.');
  });

  test('an explicitly empty control environment emits no controller message', () => {
    const messages = build({});

    expect(messages.some((message) => String(message.content).includes('[제어 표면]'))).toBe(false);
  });

  test('falls back to the controller environment when no control environment is injected', () => {
    const controller = process.env.MONAD_CONTROLLER;
    const channels = process.env.MONAD_CONTROL_CHANNELS;
    process.env.MONAD_CONTROLLER = 'harness:run-43b0457ad01bebc1';
    process.env.MONAD_CONTROL_CHANNELS = 'pty,inbox';
    try {
      const messages = build();
      const controllerMessage = messages.find((message) => String(message.content).includes('[제어 표면]'));

      expect(controllerMessage?.content).toContain('harness:run-43b0457ad01bebc1');
      expect(controllerMessage?.content).toContain('pty,inbox');
    } finally {
      if (controller === undefined) delete process.env.MONAD_CONTROLLER;
      else process.env.MONAD_CONTROLLER = controller;
      if (channels === undefined) delete process.env.MONAD_CONTROL_CHANNELS;
      else process.env.MONAD_CONTROL_CHANNELS = channels;
    }
  });

  test('without a controller, the preamble preserves its output', () => {
    const controller = process.env.MONAD_CONTROLLER;
    const channels = process.env.MONAD_CONTROL_CHANNELS;
    delete process.env.MONAD_CONTROLLER;
    delete process.env.MONAD_CONTROL_CHANNELS;
    try {
      expect(build()).toEqual(build({}));
    } finally {
      if (controller === undefined) delete process.env.MONAD_CONTROLLER;
      else process.env.MONAD_CONTROLLER = controller;
      if (channels === undefined) delete process.env.MONAD_CONTROL_CHANNELS;
      else process.env.MONAD_CONTROL_CHANNELS = channels;
    }
  });
});

describe('buildDashboardTurnPreamble — 자기접근 규율', () => {
  test('drains queued task notifications into one user message only once', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'preamble-'));
    globalTaskNotificationQueue.clear();
    globalTaskNotificationQueue.enqueue({
      taskId: 'task-dashboard-notification',
      agentName: 'dashboard-agent',
      state: 'done',
      output: 'background result',
      truncated: false,
      durationMs: 50,
      finishedAt: Date.now(),
    });

    const first = buildDashboardTurnPreamble({ userText: 'continue', cwd, userConfig: fakeConfig });
    const notification = first.find((message) => message.role === 'user'
      && String(message.content).includes('<task-notification>'));
    expect(notification?.content).toContain('background result');

    const second = buildDashboardTurnPreamble({ userText: 'continue', cwd, userConfig: fakeConfig });
    expect(second).toHaveLength(first.length - 1);
    expect(second.some((message) => String(message.content).includes('<task-notification>'))).toBe(false);
    globalTaskNotificationQueue.clear();
  });

  test('preamble 에 [monad 자기접근 규율] system 메시지가 포함된다', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'preamble-'));
    const msgs = buildDashboardTurnPreamble({ userText: 'P2 왜 실패했어?', cwd, userConfig: fakeConfig });
    const hasDiscipline = msgs.some((m) => m.role === 'system'
      && typeof m.content === 'string' && m.content.includes('[monad 자기접근 규율]'));
    expect(hasDiscipline).toBe(true);
    // 규율이 ops_status 사용을 지시하는지(진단 디시플린) — 문구 계약.
    const discipline = msgs.find((m) => typeof m.content === 'string' && m.content.includes('[monad 자기접근 규율]'));
    expect(String(discipline!.content)).toContain('ops_status');
  });

  test('includes self-awareness capabilities and only the current turn session ID', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'preamble-'));
    const first = buildDashboardTurnPreamble({
      userText: 'inspect the current turn', cwd, userConfig: fakeConfig, sessionId: 'dashboard-first',
    });
    const second = buildDashboardTurnPreamble({
      userText: 'inspect the next turn', cwd, userConfig: fakeConfig, sessionId: 'dashboard-second',
    });
    const firstText = first.map((message) => String(message.content)).join('\n');
    const secondText = second.map((message) => String(message.content)).join('\n');
    for (const text of [firstText, secondText]) {
      expect(text).toContain('logs_query');
      expect(text).toContain('debug.log');
      expect(text).toContain('monad self implement');
      expect(text).toContain('harness run');
      expect(text).toContain('auto-review');
    }
    expect(firstText).toContain('현재 요청의 session ID: dashboard-first');
    expect(firstText).not.toContain('dashboard-second');
    expect(secondText).toContain('현재 요청의 session ID: dashboard-second');
    expect(secondText).not.toContain('dashboard-first');
  });
});

// ── tools.nativeStructure.providers 배선 (2026-08-18) ────────────────────────
//
// ⛔ 왜 이 테스트가 있나 — `isNativeStructureEnabledForProvider` 가 «소비처 0» 이면
//   그 설정은 실행 경로에 없다(리뷰 must-fix). 이 테스트가 그 배선을 «증명»한다.
//   ⭐ preamble 산출을 «비교»하는 방식이라, 배선을 빼면 두 산출이 같아져 실패한다.
describe('buildDashboardTurnPreamble — nativeStructure providers 배선', () => {
  const cfgWith = (nativeStructure: unknown, provider: string) => ({
    chat: { conciseness: 'balanced' },
    llm: { provider },
    tools: { nativeStructure },
  } as unknown as ReturnType<typeof getUserConfig>);

  // ⛔ 목록에 «든» provider 와 «안 든» provider 로 같은 턴을 만들어 산출을 대조한다.
  //   배선이 없으면 둘 다 「켜짐」이 되어 산출이 같아진다.
  test('providers 목록에 없는 provider 는 켜지지 않는다 (목록에 있으면 켜진다)', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'preamble-ns-'));
    const args = { userText: '이 기능을 구현해줘', cwd, enabledTools: ['Read', 'Grep', 'Edit', 'PersistentGrounding'] };

    const listed = buildDashboardTurnPreamble({
      ...args, userConfig: cfgWith({ enabled: true, providers: ['grok'] }, 'grok'),
    }).map(m => String(m.content)).join('\n');
    const unlisted = buildDashboardTurnPreamble({
      ...args, userConfig: cfgWith({ enabled: true, providers: ['grok'] }, 'openai-codex'),
    }).map(m => String(m.content)).join('\n');

    expect(listed).not.toBe(unlisted);
  });

  test('목록이 없으면 종전대로 전 provider 에 적용된다 (하위 호환)', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'preamble-ns-'));
    const args = { userText: '이 기능을 구현해줘', cwd, enabledTools: ['Read', 'Grep', 'Edit', 'PersistentGrounding'] };

    const a = buildDashboardTurnPreamble({
      ...args, userConfig: cfgWith({ enabled: true }, 'grok'),
    }).map(m => String(m.content)).join('\n');
    const b = buildDashboardTurnPreamble({
      ...args, userConfig: cfgWith({ enabled: true }, 'openai-codex'),
    }).map(m => String(m.content)).join('\n');

    expect(a).toBe(b);
  });

  test('꺼져 있으면 목록이 무엇이든 아무 provider 에도 적용되지 않는다', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'preamble-ns-'));
    const args = { userText: '이 기능을 구현해줘', cwd, enabledTools: ['Read', 'Grep', 'Edit', 'PersistentGrounding'] };

    const off = buildDashboardTurnPreamble({
      ...args, userConfig: cfgWith({ enabled: false, providers: ['grok'] }, 'grok'),
    }).map(m => String(m.content)).join('\n');
    const noConfig = buildDashboardTurnPreamble({
      ...args, userConfig: cfgWith(undefined, 'grok'),
    }).map(m => String(m.content)).join('\n');

    expect(off).toBe(noConfig);
  });
});
