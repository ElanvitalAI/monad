import { describe, expect, test } from 'bun:test';
import { runSelfImplement, quotaLedgerFields, type GoalExecutionRecord, type SelfImplementSeams } from './orchestrator.js';
import { seams } from './test-seams.js';

/**
 * ⛔⭐⭐ **원장 배선 회귀** — 종전 결손은 「쿼터 증거가 «로그에만» 있고 원장엔 없다」였다(`F12`).
 * 그 형태는 연합 키가 「로그엔 있는데 원장엔 0건」이던 것과 ***같다***(`#10165`).
 * ⇒ 그래서 순수 사상뿐 아니라 ***record 가 실제로 그 칸을 갖는지***를 문다.
 */
describe('quotaLedgerFields — 순수 사상', () => {
  test('없으면 칸을 «안 만든다» — 0 을 적지 않는다', () => {
    expect(quotaLedgerFields(undefined)).toEqual({});
    expect(quotaLedgerFields({})).toEqual({});
  });

  test('있으면 그대로 옮긴다', () => {
    expect(quotaLedgerFields({
      quotaExhausted: true,
      quotaAccountAvailability: { reason: 'no-candidate', candidateCount: 0 },
    })).toEqual({
      quotaExhausted: true,
      quotaAccountAvailability: { reason: 'no-candidate', candidateCount: 0 },
    });
  });

  test('⛔ false 도 «값»이다 — undefined 와 갈린다', () => {
    expect(quotaLedgerFields({ quotaExhausted: false })).toEqual({ quotaExhausted: false });
  });
});

describe('원장 record 가 쿼터 증거를 갖는다 (배선)', () => {
  test('버려진 런의 record 에 quotaAccountAvailability 가 굳는다', async () => {
    const records: GoalExecutionRecord[] = [];
    const s = seams({ gateResults: [false, false] });
    let diagnoses = 0;
    s.diagnose = async () => ++diagnoses === 1
      ? 'BUDGET: EXTEND\nREASON: one more rework round is needed'
      : 'BUDGET: UNCONVERGEABLE\nREASON: implementation cannot converge';
    s.judgmentCallLLM = async ({ prompt }) => prompt.match(/BUDGET:\s*(EXTEND|UNCONVERGEABLE)/)?.[1] ?? 'EXTEND';
    s.currentProviderName = () => 'openai-codex';
    s.inspectCodexRotation = (() => ({
      reason: 'rotated',
      candidateCount: 2,
      to: 'team',
      currentUsedPercent: 100,
      currentSignalFresh: true,
      thresholdPercent: 95,
      candidates: [{ name: 'team', home: '/h/team' }, { name: 'third', home: '/h/third' }],
      freshByHome: { '/h/team': false, '/h/third': false },
    })) as unknown as SelfImplementSeams['inspectCodexRotation'];

    const result = await runSelfImplement({
      feature: 'quota evidence must survive into the ledger',
      runId: 'run-ledger-quota',
      maxReworkRounds: 2,
      goalFile: 'docs/goals/GOAL-ledger-quota-probe.txt',
      writeGoalExecutionRecord: (_path, record) => { records.push(record); },
      seams: s,
    });

    expect(result.outcome).toBe('abandoned');
    expect(records).toHaveLength(1);
    // ⭐ 이 단언이 이 파일의 «이유»다 — 로그가 아니라 ***원장 record*** 를 본다
    expect(records[0]).toMatchObject({
      runId: 'run-ledger-quota',
      quotaAccountAvailability: {
        reason: 'rotated',
        candidateCount: 2,
        to: 'team',
        toSignalFresh: false,             // ⭐ 「모르고 갔다」가 원장에 남는다
        unknownStateCandidateCount: 2,
        thresholdPercent: 95,
        currentUsedPercent: 100,
        currentSignalFresh: true,
      },
    });
    // ⛔⭐ **`quotaExhausted` 는 여기 «없다» — 그리고 그것이 계약이다.**
    //   분류 타입이 `quotaExhausted?: true` 라 ***「안 찼다」와 「모른다」가 같은 부재***로 적힌다.
    //   ⚠️ 즉 이 한 칸이 두 뜻을 덮는다(`F44` 지문). 지금은 `quotaAccountAvailability.reason` 이
    //   그것을 갈라 주므로 «판정에 손대지 않고» 계약으로 못 박기만 한다.
    expect('quotaExhausted' in records[0]!).toBe(false);
  });

  test('⛔ 쿼터 증거가 «없는» 런에는 칸을 안 만든다', async () => {
    const records: GoalExecutionRecord[] = [];
    await runSelfImplement({
      feature: 'clean run keeps the ledger free of quota columns',
      runId: 'run-ledger-noquota',
      goalFile: 'docs/goals/GOAL-ledger-noquota-probe.txt',
      writeGoalExecutionRecord: (_path, record) => { records.push(record); },
      seams: seams({
        gateResults: [true],
        currentProviderName: () => 'openai-codex',
        inspectCodexRotation: (() => ({ reason: 'rotated', candidateCount: undefined })) as SelfImplementSeams['inspectCodexRotation'],
      }),
    });
    expect(records).toHaveLength(1);
    expect('quotaAccountAvailability' in records[0]!).toBe(false);
    expect('quotaExhausted' in records[0]!).toBe(false);
  });
});
