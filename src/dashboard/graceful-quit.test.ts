// 종료 계약 — ⛔ 「하드 종료」에서 「graceful」로. 대표 지시 셋(자식 정리 · 세션 안내 · 확인).
import { describe, test, expect, spyOn } from 'bun:test';
import {
  gracefulQuit, buildResumeGuidance, buildQuitConfirmPrompt, buildForceKillConfirmPrompt, countLiveChildren,
  createQuitConfirmationState, type QuitConfirmationState,
} from './graceful-quit.js';
import { AgentRegistry } from '../agent/registry.js';
import { debug } from '../debug/log.js';
import type { AgentDefinition } from '../agent/types.js';

const def = (name: string): AgentDefinition => ({ name, systemPrompt: 'sim' });
function regWith(running: number, done = 0): AgentRegistry {
  const reg = new AgentRegistry();
  for (let i = 0; i < running; i++) {
    const t = reg.register(def(`r${i}`), 'x'); t.state = 'running'; t.startedAt = Date.now();
  }
  for (let i = 0; i < done; i++) {
    const t = reg.register(def(`d${i}`), 'x'); t.state = 'done'; t.finishedAt = Date.now();
  }
  return reg;
}

describe('countLiveChildren — 「무엇이 멈추나」를 정직하게 센다', () => {
  test('도는 것만 센다 — 끝난 것은 빼고', () => {
    expect(countLiveChildren(regWith(3, 2))).toBe(3);
  });
  test('없으면 0', () => expect(countLiveChildren(regWith(0))).toBe(0));
});

describe('buildQuitConfirmPrompt — ⛔ 「정말?」만 묻지 않는다 · 둘을 «갈라서» 말한다', () => {
  test('⭐ 서브에이전트와 하니스 자식의 «운명이 다르다»고 말한다', () => {
    const p = buildQuitConfirmPrompt({ subagents: 2, harnessChildren: 3 });
    expect(p.prompt).toContain('서브에이전트 2개');
    expect(p.prompt).toContain('중단됩니다');
    expect(p.prompt).toContain('하니스 자식 3개');
    // ⛔ 2026-08-19 실측 정정 — 자식도 «함께» 죽는다. 도구가 거짓을 말하지 않는다.
    expect(p.prompt).toContain('함께 중단됩니다');
    expect(p.prompt).not.toContain('계속 돕니다');
  });
  test('자식이 없으면 「없다」고 말한다 — 겁주지 않는다', () => {
    expect(buildQuitConfirmPrompt({ subagents: 0, harnessChildren: 0 }).prompt).toContain('없습니다');
  });
  test('⭐⭐ 타임아웃이면 «나간다» — Ctrl+Q 를 누른 것이 이미 의사 표시다', () => {
    const p = buildQuitConfirmPrompt({ subagents: 1, harnessChildren: 0 });
    expect(p.onTimeout).toBe('quit');
    expect(p.timeoutMs).toBeGreaterThan(0);
  });
});

describe('buildForceKillConfirmPrompt — 확인 ② (계속 도는 것마저 죽일까)', () => {
  test('⛔ 물을 것이 없으면 «묻지 않는다» — 소음을 만들지 않는다', () => {
    expect(buildForceKillConfirmPrompt(0)).toBeNull();
  });
  test('⭐ 무엇을 잃는지 말한다', () => {
    const p = buildForceKillConfirmPrompt(2)!;
    expect(p.prompt).toContain('2개');
    expect(p.detail).toContain('스스로 마무리');
    expect(p.detail).toContain('사라집니다');
  });
  test('⭐⭐⭐ 타임아웃이면 «남겨둔다» — 파괴적 동작은 «절대» 타임아웃으로 안 일어난다', () => {
    const p = buildForceKillConfirmPrompt(2)!;
    expect(p.onTimeout).toBe('keep');
    expect(p.noLabel).toContain('기본');
  });
});

describe('buildResumeGuidance — ⛔ «셸에서 칠 수 있는» 명령으로', () => {
  test('⭐ 종전 문면(`/session load`)은 TUI 안 명령이라 셸에서 못 친다 — 셸 명령을 준다', () => {
    const g = buildResumeGuidance('sess-123');
    expect(g).toContain('sess-123');
    expect(g).toContain('monad');
    expect(g).toContain('/resume sess-123');
    expect(g).toContain('monad chat --session sess-123');
    expect(g).toContain('monad session list');
  });
  test('id 를 «모르면» 모른다고 하고 찾는 길을 준다 — 꾸미지 않는다', () => {
    const g = buildResumeGuidance(undefined);
    expect(g).toContain('기록하지 못했습니다');
    expect(g).toContain('monad session list');
  });
});

describe('gracefulQuit — 자식 정리 ⊕ 안내 ⊕ 순서', () => {
  test('도는 자식이 없으면 즉시 닫고 안내하며 immediate를 기록한다', () => {
    const out: string[] = [];
    const log = spyOn(debug, 'log').mockImplementation(() => {});
    let closed = 0;
    const r = gracefulQuit({ registry: regWith(0), closeTui: () => { closed++; }, write: (m) => { out.push(m); } });
    expect(r.awaitingConfirmation).not.toBe(true);
    expect(closed).toBe(1);
    expect(out.join('')).toContain('돌고 있던 작업은 없었습니다');
    expect(log).toHaveBeenCalledWith('quit.confirm', 'immediate', { runningChildren: 0 });
    log.mockRestore();
  });

  test('명시 상태의 반복 호출은 자식 수를 기록하고 시간 창 안에서 확인한다', () => {
    const out: string[] = [];
    const log = spyOn(debug, 'log').mockImplementation(() => {});
    const confirmationState = createQuitConfirmationState();
    let closed = 0;
    let time = 100;
    const deps = {
      registry: regWith(2), harnessChildren: 2, confirmationState, confirmationWindowMs: 50,
      now: () => time, closeTui: () => { closed++; }, write: (m: string) => { out.push(m); },
    };
    const first = gracefulQuit(deps);
    expect(first.awaitingConfirmation).toBe(true);
    expect(first.stoppedChildren).toBe(0);
    expect(closed).toBe(0);
    expect(out.join('')).toContain('서브에이전트 2개');
    expect(out.join('')).toContain('하니스 자식 2개');
    expect(log).toHaveBeenCalledWith('quit.confirm', 'open-confirmation', { runningChildren: 4 });

    time = 150;
    const second = gracefulQuit(deps);
    expect(second.awaitingConfirmation).not.toBe(true);
    expect(closed).toBe(1);
    expect(log).toHaveBeenCalledWith('quit.confirm', 'confirm-by-repeat', { runningChildren: 4 });
    log.mockRestore();
  });

  test('상태를 주입하지 않은 서로 다른 경로는 같은 closeTui여도 서로 확인하지 않는다', () => {
    let closed = 0;
    const closeTui = () => { closed++; };
    const deps = { registry: regWith(0), harnessChildren: 1, closeTui, write: () => {} };
    expect(gracefulQuit(deps).awaitingConfirmation).toBe(true);
    expect(gracefulQuit(deps).awaitingConfirmation).toBe(true);
    expect(closed).toBe(0);
  });

  test('확인 창이 지나면 다시 확인을 열고 종료하지 않는다', () => {
    const out: string[] = [];
    const log = spyOn(debug, 'log').mockImplementation(() => {});
    const state: QuitConfirmationState = {};
    let closed = 0;
    let time = 100;
    const deps = {
      registry: regWith(0), harnessChildren: 2, confirmationState: state, confirmationWindowMs: 50,
      now: () => time, closeTui: () => { closed++; }, write: (m: string) => { out.push(m); },
    };
    gracefulQuit(deps);
    time = 151;
    const retry = gracefulQuit(deps);
    expect(retry.awaitingConfirmation).toBe(true);
    expect(closed).toBe(0);
    expect(out).toHaveLength(2);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith('quit.confirm', 'open-confirmation', { runningChildren: 2 });
    log.mockRestore();
  });

  test('종료 경로별 확인 상태는 서로의 반복 확인이 되지 않는다', () => {
    const firstPath = createQuitConfirmationState();
    const secondPath = createQuitConfirmationState();
    let closed = 0;
    const base = {
      registry: regWith(0), harnessChildren: 1, confirmationWindowMs: 50, now: () => 100,
      closeTui: () => { closed++; }, write: () => {},
    };
    expect(gracefulQuit({ ...base, confirmationState: firstPath }).awaitingConfirmation).toBe(true);
    expect(gracefulQuit({ ...base, confirmationState: secondPath }).awaitingConfirmation).toBe(true);
    expect(closed).toBe(0);
  });

  test('비상 종료는 레지스트리 조회 실패와 확인 대기 상태를 건너뛴다', () => {
    const log = spyOn(debug, 'log').mockImplementation(() => {});
    const state: QuitConfirmationState = { openedAt: 100 };
    let closed = 0;
    const r = gracefulQuit({
      registry: { abortAll: () => 0, list: () => { throw new Error('list failed'); } },
      harnessChildren: 3, forceQuit: true, confirmationState: state,
      closeTui: () => { closed++; }, write: () => {},
    });
    expect(r.awaitingConfirmation).not.toBe(true);
    expect(closed).toBe(1);
    expect(state.openedAt).toBeUndefined();
    expect(log).toHaveBeenCalledWith('quit.confirm', 'forced', { runningChildren: 3 });
    log.mockRestore();
  });

  test('비상 종료는 자식과 확인 대기 상태를 건너뛴다', () => {
    const out: string[] = [];
    const state: QuitConfirmationState = { openedAt: 100 };
    let closed = 0;
    const r = gracefulQuit({
      registry: regWith(0), harnessChildren: 3, forceQuit: true, confirmationState: state,
      closeTui: () => { closed++; }, write: (m) => { out.push(m); },
    });
    expect(r.awaitingConfirmation).not.toBe(true);
    expect(closed).toBe(1);
    expect(out.join('')).not.toContain('정말 나가시겠습니까');
    expect(state.openedAt).toBeUndefined();
  });

  test('⭐ 자식을 «먼저» 멈추고 그다음 TUI 를 닫는다', () => {
    const order: string[] = [];
    const reg = regWith(2);
    const out: string[] = [];
    const r = gracefulQuit({
      registry: { abortAll: () => { order.push('abort'); return reg.abortAll(); }, list: () => reg.list() },
      forceQuit: true,
      closeTui: () => { order.push('closeTui'); },
      getSessionId: () => 'sess-abc',
      write: (m) => { out.push(m); },
    });
    expect(order).toEqual(['abort', 'closeTui']);   // ⛔ 순서가 뒤집히면 자식 로그가 갈 곳을 잃는다
    expect(r.stoppedChildren).toBe(2);
    expect(out.join('')).toContain('서브에이전트 2개를 중단했습니다');
    expect(out.join('')).toContain('/resume sess-abc');
  });

  test('⭐⭐ 하니스 자식은 «기본으로 남긴다» ⊕ 무엇을 남겼는지 알린다', () => {
    const out: string[] = [];
    const r = gracefulQuit({
      registry: regWith(0), harnessChildren: 3, forceQuit: true,
      closeTui: () => {}, getSessionId: () => 's', write: (m) => { out.push(m); },
    });
    expect(r.killedHarnessChildren).toBe(false);
    expect(out.join('')).toContain('하니스 자식 3개');
    expect(out.join('')).toContain('함께 중단됐습니다');
    expect(out.join('')).toContain('재발사');
  });

  test('⛔ 강제 종료는 «명시»했을 때만 — 그리고 실제로 죽인 자가 있어야 «죽였다»고 말한다', () => {
    const out: string[] = [];
    let killed = 0;
    const r = gracefulQuit({
      registry: regWith(0), harnessChildren: 2, forceQuit: true,
      forceKillHarnessChildren: true, killHarnessChildren: () => { killed = 2; return 2; },
      closeTui: () => {}, getSessionId: () => 's', write: (m) => { out.push(m); },
    });
    expect(killed).toBe(2);
    expect(r.killedHarnessChildren).toBe(true);
    expect(out.join('')).toContain('강제 종료했습니다');
  });

  test('⛔ 죽이는 자가 «없으면» 죽였다고 말하지 않는다', () => {
    const out: string[] = [];
    const r = gracefulQuit({
      registry: regWith(0), harnessChildren: 2, forceQuit: true, forceKillHarnessChildren: true,
      closeTui: () => {}, getSessionId: () => 's', write: (m) => { out.push(m); },
    });
    expect(r.killedHarnessChildren).toBe(false);
    expect(out.join('')).toContain('함께 중단됐습니다');
  });

  test('멈출 자식이 없으면 «중단했다»고 말하지 않는다', () => {
    const out: string[] = [];
    gracefulQuit({
      registry: regWith(0), closeTui: () => {}, getSessionId: () => 's', write: (m) => { out.push(m); },
    });
    expect(out.join('')).not.toContain('중단했습니다');
  });

  test('⛔ 자식 정리 실패가 종료를 «막지 않는다» — 안내는 그래도 나간다', () => {
    const out: string[] = [];
    const r = gracefulQuit({
      registry: { abortAll: () => { throw new Error('boom'); }, list: () => [] },
      closeTui: () => {}, getSessionId: () => 'sX', write: (m) => { out.push(m); },
    });
    expect(r.stoppedChildren).toBe(0);
    expect(out.join('')).toContain('sX');
  });

  test('⛔ closeTui 실패도 안내를 «막지 않는다»', () => {
    const out: string[] = [];
    gracefulQuit({
      registry: regWith(1), forceQuit: true,
      closeTui: () => { throw new Error('already closed'); },
      getSessionId: () => 'sY', write: (m) => { out.push(m); },
    });
    expect(out.join('')).toContain('sY');
  });
});
