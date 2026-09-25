import { describe, expect, test } from 'bun:test';
import { dashboardCanUseTty, dashboardTtyRefusalMessage } from '../src/dashboard/tty-required.js';

describe('dashboard TTY guard — 엔터 폭풍 회귀 방어 (2026-09-17)', () => {
  test('stdin 이 TTY 면 뜬다', () => {
    expect(dashboardCanUseTty({ isTTY: true })).toBe(true);
  });

  test('stdin 이 TTY 가 «아니면» 안 뜬다 — 그 침묵이 초당 수백 프레임을 만들었다', () => {
    expect(dashboardCanUseTty({ isTTY: false })).toBe(false);
    expect(dashboardCanUseTty({})).toBe(false);
  });

  test('거부 문면은 «다음에 칠 것»을 댄다 — 스택이 아니라 길을 준다', () => {
    const msg = dashboardTtyRefusalMessage();
    expect(msg).toContain('TTY');
    expect(msg).toContain('monad ask');
    expect(msg).toContain('monad repl');
    // ⛔ 스택 트레이스를 흉내 내지 않는다(읽히는 실패 계약 · #18720)
    expect(msg).not.toContain('    at ');
  });
});
