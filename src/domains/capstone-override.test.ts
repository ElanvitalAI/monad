import { test, expect, describe, afterEach } from 'bun:test';
import {
  resolveCapstoneRegime, addOverride, listActiveOverrides, listAllOverrides,
  cancelOverride, type CapstoneOverride, type AutoRegime,
} from './capstone-override.js';
import { existsSync, unlinkSync } from 'node:fs';

const TMP = '/tmp/capstone-override-test.db';
afterEach(() => { if (existsSync(TMP)) unlinkSync(TMP); });

function ov(partial: Partial<CapstoneOverride> & Pick<CapstoneOverride, 'kind'>): CapstoneOverride {
  return {
    id: 'ov1', params: {}, reason: 'test', scope: 'until_cancelled',
    expiresAt: null, event: null, priority: 0, status: 'active',
    createdBy: 'owner', createdAt: '2026-07-06T00:00:00Z', ...partial,
  };
}
const autoBear: AutoRegime = { target: 'CASH_100', bear: true, r3: false };
const autoBull: AutoRegime = { target: 'LONG_100', bear: false, r3: false };

describe('resolveCapstoneRegime — 사람 우선', () => {
  test('오버라이드 없음 → 자동 그대로', () => {
    const r = resolveCapstoneRegime(autoBear, []);
    expect(r.source).toBe('auto');
    expect(r.target).toBe('CASH_100');
  });

  test('force_regime BULL: 자동 BEAR여도 강세 강제(1.5×)', () => {
    const r = resolveCapstoneRegime(autoBear, [ov({ kind: 'force_regime', params: { regime: 'BULL' } })]);
    expect(r.source).toBe('override');
    expect(r.target).toBe('LONG_100');
    expect(r.bear).toBe(false);
  });

  test('force_regime BEAR: 자동 BULL여도 방어 강제', () => {
    const r = resolveCapstoneRegime(autoBull, [ov({ kind: 'force_regime', params: { regime: 'BEAR' } })]);
    expect(r.target).toBe('CASH_100');
    expect(r.bear).toBe(true);
  });

  test('arm_entry: 자동이 진입 아니어도 매수 무장(LONG)', () => {
    const r = resolveCapstoneRegime(autoBear, [ov({ kind: 'arm_entry' })]);
    expect(r.target).toBe('LONG_100');
    expect(r.source).toBe('override');
  });

  test('block_entry: 자동 LONG → CASH로 강등', () => {
    const r = resolveCapstoneRegime(autoBull, [ov({ kind: 'block_entry' })]);
    expect(r.target).toBe('CASH_100');
  });

  test('block_entry: 자동이 이미 CASH면 효과 없음 → 자동 유지(다음 오버라이드로)', () => {
    const r = resolveCapstoneRegime(autoBear, [ov({ kind: 'block_entry' })]);
    expect(r.source).toBe('auto'); // block_entry skip → fallback
  });

  test('hold_position: 자동 유지 + hold 플래그(리밸런싱 안 함)', () => {
    const r = resolveCapstoneRegime(autoBull, [ov({ kind: 'hold_position' })]);
    expect(r.hold).toBe(true);
    expect(r.source).toBe('override');
  });

  test('pause_auto: 자동 정지 플래그', () => {
    const r = resolveCapstoneRegime(autoBull, [ov({ kind: 'pause_auto' })]);
    expect(r.paused).toBe(true);
  });

  test('우선순위: block_entry(skip) 뒤 force_regime 적용 (배열 순서=priority desc)', () => {
    // 자동 CASH → block_entry 효과없음(skip) → force_regime BULL 적용
    const r = resolveCapstoneRegime(autoBear, [
      ov({ id: 'a', kind: 'block_entry', priority: 10 }),
      ov({ id: 'b', kind: 'force_regime', params: { regime: 'BULL' }, priority: 5 }),
    ]);
    expect(r.target).toBe('LONG_100');
    expect(r.overrideId).toBe('b');
  });
});

describe('SQLite CRUD (감사)', () => {
  test('add → listActive 반환', () => {
    addOverride(ov({ id: 'x1', kind: 'force_regime', params: { regime: 'BEAR' }, reason: '7/7 방어' }), TMP);
    const act = listActiveOverrides('2026-07-06', TMP);
    expect(act).toHaveLength(1);
    expect(act[0].kind).toBe('force_regime');
    expect(act[0].params.regime).toBe('BEAR');
  });

  test('until_date 만료: expiresAt < today → expired(active 제외, 이력 보존)', () => {
    addOverride(ov({ id: 'x2', kind: 'block_entry', scope: 'until_date', expiresAt: '2026-07-11', reason: 'KORU 홀드' }), TMP);
    expect(listActiveOverrides('2026-07-10', TMP)).toHaveLength(1); // 아직 유효
    expect(listActiveOverrides('2026-07-12', TMP)).toHaveLength(0); // 만료
    expect(listAllOverrides(TMP)[0].status).toBe('expired');        // 이력엔 남음
  });

  test('cancel → active 제외', () => {
    addOverride(ov({ id: 'x3', kind: 'pause_auto' }), TMP);
    expect(cancelOverride('x3', TMP)).toBe(true);
    expect(listActiveOverrides('2026-07-06', TMP)).toHaveLength(0);
  });

  test('priority desc 정렬', () => {
    addOverride(ov({ id: 'lo', kind: 'hold_position', priority: 1, createdAt: '2026-07-06T01:00:00Z' }), TMP);
    addOverride(ov({ id: 'hi', kind: 'force_regime', params: { regime: 'BULL' }, priority: 9, createdAt: '2026-07-06T02:00:00Z' }), TMP);
    const act = listActiveOverrides('2026-07-06', TMP);
    expect(act[0].id).toBe('hi'); // priority 9 먼저
  });
});
