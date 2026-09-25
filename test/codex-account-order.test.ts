/**
 * 회전이 «먼저 쓸» 계정 순서를 설정에서 읽는가.
 *
 * 🩸 왜 (대표 지시 2026-09-24): 「third 부터 소진하고 그다음 team」.
 *   그런데 회전은 ***이름 코드포인트 순***으로 골랐다 — `default < new(team) < third` 라
 *   그 순서를 ***원리상 못 만든다***.
 * ⛔ 이 시험은 「설정이 이긴다」와 「없는 계정은 버리지 않는다」 둘을 «값으로» 문다.
 */
import { describe, expect, test } from 'bun:test';
import { decideCodexRotation } from '../src/oauth/codex-account-rotation.js';

const cand = (name: string) => ({ name, storeKey: name, home: `/h/${name}`, reached: false, usedPercent: 0 });
/** ⛔ `as never` 로 두면 spread 를 못 한다(TS2698) — 객체 타입으로 두고 호출부에서 좁힌다. */
const base = {
  current: { name: 'cur', storeKey: 'cur', home: '/h/cur' },
  explicit: false,
  enabled: true,
  disabledProvenance: undefined,
  currentReached: true,
  currentUsedPercent: 100,
  resetCreditAvailability: 'unavailable' as const,
};

describe('회전 순서', () => {
  test('설정 순서가 이름순을 «이긴다» — third 가 먼저 뽑힌다', () => {
    const r = decideCodexRotation({
      ...base,
      candidates: [cand('default'), cand('team'), cand('third')],
      accountOrder: ['third', 'team', 'default'],
    } as never);
    expect(r.reason).toBe('rotated');
    expect(r.to?.name).toBe('third');
  });

  /** ⛔ 음성 대조 — 설정이 «없으면» 옛 동작(이름 코드포인트 순)이 그대로다. */
  test('설정이 없으면 이름 코드포인트 순 — default 가 먼저', () => {
    const r = decideCodexRotation({
      ...base,
      candidates: [cand('third'), cand('team'), cand('default')],
    } as never);
    expect(r.to?.name).toBe('default');
  });

  /** ⭐ 목록에 «없는» 계정을 버리면 그 계정으로 영영 못 넘어간다. */
  test('목록에 없는 계정은 버리지 않는다 — 뒤로 가서 이름순으로 붙는다', () => {
    const r = decideCodexRotation({
      ...base,
      candidates: [cand('zulu'), cand('alpha')],
      accountOrder: ['third'],
    } as never);
    expect(r.to?.name, '목록에 없어도 후보로 남는다').toBe('alpha');
  });
});
