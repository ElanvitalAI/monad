import { describe, expect, it } from 'bun:test';
import { quotaAvailabilityEvidence, assessQuotaExhaustion } from './orchestrator.js';

/**
 * ⛔⭐ 이 파일이 무는 것 — ***「회전 스냅샷이 아는 것」과 「증거에 남는 것」이 갈리지 않는가***.
 *
 * 종전 결손: 스냅샷은 `to`·`freshByHome`·`candidates` 를 갖는데 증거는 `reason`·`candidateCount`
 * 둘만 실었다. 그래서 런이 429 로 죽어도 ***「어느 계정으로 갔나」도 「그 상태를 알았나」도***
 * 원장에 한 글자도 안 남았다(`F41` — 생산자↔소비자 불일치).
 */
describe('quotaAvailabilityEvidence — 회전 스냅샷을 좁히지 않는다', () => {
  const snap = (over: Record<string, unknown> = {}) => ({
    reason: 'rotated',
    candidateCount: 2,
    to: 'team',
    currentUsedPercent: 100,
    currentSignalFresh: true,
    thresholdPercent: 95,
    candidates: [
      { name: 'team', home: '/h/team' },
      { name: 'third', home: '/h/third' },
    ],
    freshByHome: { '/h/team': false, '/h/third': false },
    ...over,
  });

  it('⭐ 회전 대상과 «그 상태를 알았나»를 낸다 — 이 축의 핵심', () => {
    const e = quotaAvailabilityEvidence(snap());
    expect(e.to).toBe('team');
    expect(e.toSignalFresh).toBe(false);          // 만료된 신호 ⇒ 「모르고 갔다」
    expect(e.unknownStateCandidateCount).toBe(2);
  });

  it('신호가 신선하면 «알고 갔다»로 남는다', () => {
    const e = quotaAvailabilityEvidence(snap({
      candidates: [{ name: 'team', home: '/h/team', usedPercent: 12, reached: false }],
      freshByHome: { '/h/team': true },
    }));
    expect(e.toSignalFresh).toBe(true);
    expect(e.unknownStateCandidateCount).toBe(0);
  });

  it('⛔ 대상을 후보에서 못 찾으면 신선도를 «안 낸다» — 모르는 것을 false 로 적지 않는다', () => {
    const e = quotaAvailabilityEvidence(snap({ to: 'ghost' }));
    expect(e.to).toBe('ghost');
    expect('toSignalFresh' in e).toBe(false);
  });

  it('갈 곳이 없으면 to 를 안 낸다(no-candidate)', () => {
    const e = quotaAvailabilityEvidence(snap({ reason: 'no-candidate', to: undefined, candidateCount: 0, candidates: [] }));
    expect('to' in e).toBe(false);
    expect('unknownStateCandidateCount' in e).toBe(false);   // 후보가 없으면 분모가 없다
    expect(e.reason).toBe('no-candidate');
  });

  it('⛔ 판정 결론은 «안 바뀐다» — 관측만 넓혔다', () => {
    expect(assessQuotaExhaustion('openai-codex', quotaAvailabilityEvidence(snap())).exhausted).toBe(false);
    expect(assessQuotaExhaustion('openai-codex',
      quotaAvailabilityEvidence(snap({ reason: 'no-candidate', to: undefined, candidateCount: 0, candidates: [] }))).exhausted).toBe(true);
    // 그리고 넓힌 칸이 결론과 «함께» 보존된다
    const kept = assessQuotaExhaustion('openai-codex', quotaAvailabilityEvidence(snap())).accountAvailability;
    expect(kept?.to).toBe('team');
    expect(kept?.thresholdPercent).toBe(95);
  });

  it('reset-credit-available 은 소진이다 — 그 시점에 쓸 수 있는 계정이 하나도 없다', () => {
    expect(assessQuotaExhaustion('openai-codex',
      quotaAvailabilityEvidence(snap({ reason: 'reset-credit-available', to: undefined, candidateCount: 0, candidates: [] }))).exhausted).toBe(true);
  });

  it('⛔ 「모른다」는 «둘 다» 모를 때다 — 한쪽만 보면 분모가 틀린다', () => {
    // ⭐ 이 표본이 두 정의를 «가른다»: `reached` 를 아는데 사용률만 없는 후보.
    //   느슨한 정의(사용률만 본다)면 이 후보를 「모른다」로 세어 «분모가 부푼다».
    //   ⛔ 종전 표본(usedPercent 만 있는 후보)은 두 정의에 «같은 답»을 내서 변이를 못 물었다 —
    //     그 사실 자체가 「반증이 안 물면 테스트가 약한 것」의 실례다.
    const e = quotaAvailabilityEvidence(snap({
      candidates: [
        { name: 'team', home: '/h/team', reached: false },      // 도달은 안다 · 사용률만 모른다 ⇒ 「안다」
        { name: 'third', home: '/h/third' },                     // 둘 다 모른다              ⇒ 「모른다」
      ],
    }));
    expect(e.unknownStateCandidateCount).toBe(1);
  });
});
