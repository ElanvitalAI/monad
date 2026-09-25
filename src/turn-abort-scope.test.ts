// 턴 취소 «범위» 계약 — 「턴을 멈춘다」와 「자식을 죽인다」의 갈림.
//
// 🚨 이 계약이 깨지면 ESC 한 번이 몇 십 분짜리 하니스 런을 죽인다(2026-08-19 이전 동작).
import { describe, it, expect } from 'bun:test';
import {
  TURN_ABORT_TURN_ONLY, TURN_ABORT_KILL_CHILDREN,
  abortTurnOnly, abortAndKillChildren, turnAbortScope, abortShouldKillChildren, childLifetimeSignal,
} from './turn-abort-scope.js';

describe('turnAbortScope — 취소의 «뜻»', () => {
  it('turn-only 로 취소하면 turn-only 다', () => {
    const c = new AbortController();
    abortTurnOnly(c);
    expect(c.signal.reason).toBe(TURN_ABORT_TURN_ONLY);
    expect(turnAbortScope(c.signal)).toBe('turn-only');
    expect(abortShouldKillChildren(c.signal)).toBe(false);
  });

  it('kill-children 으로 취소하면 자식을 죽인다', () => {
    const c = new AbortController();
    abortAndKillChildren(c);
    expect(c.signal.reason).toBe(TURN_ABORT_KILL_CHILDREN);
    expect(abortShouldKillChildren(c.signal)).toBe(true);
  });

  it('⛔⭐ 하위호환 — «뜻 없는» 취소는 종전대로 자식까지 죽인다', () => {
    const c = new AbortController();
    c.abort();                                  // 이 모듈을 안 거치는 모든 기존 경로
    expect(turnAbortScope(c.signal)).toBe('kill-children');
    expect(abortShouldKillChildren(c.signal)).toBe(true);
  });

  it('안 취소된 신호는 「죽여야 한다」가 아니다', () => {
    expect(abortShouldKillChildren(new AbortController().signal)).toBe(false);
  });
});

describe('childLifetimeSignal — 자식은 «구조적으로» ESC 에 안 닿는다', () => {
  it('⭐ turn-only 취소는 자식 신호에 «안» 내려간다', () => {
    const parent = new AbortController();
    const child = childLifetimeSignal(parent.signal)!;
    abortTurnOnly(parent);
    expect(parent.signal.aborted).toBe(true);
    expect(child.aborted).toBe(false);          // ← 대표 지시의 핵심
  });

  it('kill-children 취소는 자식 신호에 내려간다 (#21 의도 보존)', () => {
    const parent = new AbortController();
    const child = childLifetimeSignal(parent.signal)!;
    abortAndKillChildren(parent);
    expect(child.aborted).toBe(true);
    expect(child.reason).toBe(TURN_ABORT_KILL_CHILDREN);
  });

  it('뜻 없는 취소도 자식에 내려간다 (/cancel 종전 경로)', () => {
    const parent = new AbortController();
    const child = childLifetimeSignal(parent.signal)!;
    parent.abort();
    expect(child.aborted).toBe(true);
  });

  it('⚠️ 부모가 «이미» turn-only 로 취소된 채 들어와도 자식은 산다 (경합 창 없음)', () => {
    const parent = new AbortController();
    abortTurnOnly(parent);
    expect(childLifetimeSignal(parent.signal)!.aborted).toBe(false);
  });

  it('⚠️ 부모가 «이미» kill 로 취소됐으면 자식도 즉시 취소 상태다', () => {
    const parent = new AbortController();
    abortAndKillChildren(parent);
    expect(childLifetimeSignal(parent.signal)!.aborted).toBe(true);
  });

  it('부모가 없으면 undefined — 호출부의 「신호 없음」 관용구를 보존한다', () => {
    expect(childLifetimeSignal(undefined)).toBeUndefined();
  });

  it('⛔ 자식 신호를 취소해도 부모는 «안» 죽는다 — 한 방향이다', () => {
    const parent = new AbortController();
    const child = childLifetimeSignal(parent.signal)!;
    expect(child.aborted).toBe(false);
    expect(parent.signal.aborted).toBe(false);
  });
});
