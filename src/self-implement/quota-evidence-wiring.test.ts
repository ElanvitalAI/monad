import { describe, expect, it } from 'bun:test';
import { readQuotaExhausted } from './orchestrator.js';

/**
 * ⛔⭐⭐ **배선 회귀** — 순수 함수 회귀는 「사상이 맞나」만 답한다.
 * 이 파일이 답하는 것은 ***「실행 경로가 그 사상을 «실제로» 쓰는가」*** 하나다.
 * 종전엔 이 자리가 `{reason, candidateCount}` 로 손수 좁히고 있었고, 그 좁힘은
 * ***순수 테스트를 아무리 늘려도 안 물렸다***.
 */
describe('readQuotaExhausted — 스냅샷을 좁히지 않고 증거로 옮긴다', () => {
  const inspector = () => ({
    reason: 'rotated',
    candidateCount: 2,
    to: 'team',
    currentUsedPercent: 100,
    currentSignalFresh: true,
    thresholdPercent: 95,
    candidates: [{ name: 'team', home: '/h/team' }, { name: 'third', home: '/h/third' }],
    freshByHome: { '/h/team': false, '/h/third': false },
  }) as unknown as Parameters<typeof readQuotaExhausted>[0] extends never ? never : any;

  it('⭐ 회전 대상·신선도·모르는 후보 수가 «실행 경로»를 통과해 증거에 실린다', () => {
    const a = readQuotaExhausted(inspector, 'openai-codex').accountAvailability;
    expect(a?.to).toBe('team');
    expect(a?.toSignalFresh).toBe(false);
    expect(a?.unknownStateCandidateCount).toBe(2);
    expect(a?.currentUsedPercent).toBe(100);
    expect(a?.thresholdPercent).toBe(95);
    // ⛔⭐ 「언제 읽었나」가 «값으로» 남는다 — 없으면 toSignalFresh 가 «결정 시점»으로 오독된다
    expect(a?.readPoint).toBe('postmortem');
  });

  it('⛔ 결론은 그대로다 — 관측만 넓혔다', () => {
    expect(readQuotaExhausted(inspector, 'openai-codex').exhausted).toBe(false);
  });

  it('codex 가 아니면 증거를 안 낸다(종전 계약 보존)', () => {
    const r = readQuotaExhausted(inspector, 'anthropic');
    expect(r.exhausted).toBeUndefined();
    expect(r.accountAvailability).toBeUndefined();
  });

  it('⛔ 조회가 던져도 판정을 막지 않는다(fail-soft 보존)', () => {
    const boom = (() => { throw new Error('disk'); }) as never;
    const r = readQuotaExhausted(boom, 'openai-codex');
    expect(r.exhausted).toBeUndefined();
  });
});
