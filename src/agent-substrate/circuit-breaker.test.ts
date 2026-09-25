// agent-loop-substrate 조각1 — circuit breaker 검증 (2026-07-19)
import { test, expect, describe } from 'bun:test';
import { createCircuitBreaker } from './circuit-breaker.js';

describe('circuit-breaker (조각1·자기종료 루프 계약)', () => {
  test('연속 실패 임계 도달 시 open (기본 3)', () => {
    const b = createCircuitBreaker();
    expect(b.record('failure').state.open).toBe(false);
    expect(b.record('failure').state.open).toBe(false);
    const r = b.record('failure');
    expect(r.state.open).toBe(true);
    expect(r.tripped).toBe(true);          // ★ 트립 순간 포착(관측 1회 방출용)
    expect(r.state.consecutiveFailures).toBe(3);
  });

  test('success 는 연속실패 리셋(회복)', () => {
    const b = createCircuitBreaker({ threshold: 2 });
    b.record('failure');
    const r = b.record('success');
    expect(r.state.consecutiveFailures).toBe(0);
    expect(r.state.open).toBe(false);
  });

  test('open 후 success 면 recovered 포착', () => {
    const b = createCircuitBreaker({ threshold: 2 });
    b.record('failure'); b.record('failure');        // open
    expect(b.state.open).toBe(true);
    const r = b.record('success');
    expect(r.recovered).toBe(true);                   // ★ 회복 순간 포착
    expect(r.state.open).toBe(false);
  });

  test('tripped 는 open 진입 순간 1회만(중복 방출 방지)', () => {
    const b = createCircuitBreaker({ threshold: 1 });
    expect(b.record('failure').tripped).toBe(true);   // 첫 트립
    expect(b.record('failure').tripped).toBe(false);  // 이미 open — 재트립 아님
  });

  test('자기인지 — lastReason 노출(왜 열렸나)', () => {
    const b = createCircuitBreaker({ threshold: 1 });
    const r = b.record('failure', 'compaction-no-reduce');
    expect(r.state.lastReason).toBe('compaction-no-reduce');
    expect(r.state.threshold).toBe(1);
  });

  test('reset 강제 회복', () => {
    const b = createCircuitBreaker({ threshold: 1 });
    b.record('failure');
    expect(b.state.open).toBe(true);
    b.reset();
    expect(b.state.open).toBe(false);
    expect(b.state.consecutiveFailures).toBe(0);
  });

  test('threshold 하한 1(0/음수 방어)', () => {
    const b = createCircuitBreaker({ threshold: 0 });
    expect(b.record('failure').state.open).toBe(true); // threshold clamp→1
  });
});
