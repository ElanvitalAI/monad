// [DIAGNOSIS] note 빌더/파서 — 진단 영속 SoT 의 왕복 보장 (P1 · 2026-07-13).
// run-mission(빌더) ↔ ops-status/TUI(파서) 가 같은 포맷을 쓰는지의 계약 테스트.
import { test, expect, describe } from 'bun:test';
import {
  buildDiagnosisNote, parseDiagnosisNote, synthesizePhaseDiagnosis,
  type PhaseOutcome,
} from './mission-phase-diagnosis.js';

const OUTCOME: PhaseOutcome = {
  phaseId: 'ph1', missionId: 'apm_x', title: 'P2 후보 검증', index: 2, total: 7,
  status: 'failed', goal: 'draft-plan 확장 후보 검증',
  failClass: 'budget-exhausted',
  attempts: [
    { backend: 'monad-self:gpt-5.6-terra', maxTurns: 1000, gateResult: 'gate-failed' },
    { backend: 'opus-4.8', gateResult: 'gate-failed' },
  ],
};

describe('buildDiagnosisNote ↔ parseDiagnosisNote 왕복', () => {
  test('신규 포맷([DIAGNOSIS:failClass]) 왕복 — failClass·heal·confidence 보존', () => {
    const diag = synthesizePhaseDiagnosis(OUTCOME);
    const note = buildDiagnosisNote(diag, OUTCOME.failClass);
    expect(note.startsWith('[DIAGNOSIS:budget-exhausted]')).toBe(true);
    const parsed = parseDiagnosisNote([note]);
    expect(parsed).not.toBeNull();
    expect(parsed!.failClass).toBe('budget-exhausted');
    expect(parsed!.heal).toBe(diag.healRecommendation.kind);
    expect(parsed!.confidence).toBe(diag.healRecommendation.confidence);
    expect(parsed!.rootCause).toBe(diag.rootCauseInference);
    expect(parsed!.narrative.length).toBeGreaterThan(0);
  });

  test('구 포맷([DIAGNOSIS]·failClass 태그 없음)도 파싱(하위 호환)', () => {
    const note = '[DIAGNOSIS] P2 실패. 목표: X. 시도: terra→gate-failed. 근본원인: 과대 페이즈 추정. 권장: split(med)';
    const parsed = parseDiagnosisNote([note]);
    expect(parsed).not.toBeNull();
    expect(parsed!.failClass).toBeUndefined();
    expect(parsed!.heal).toBe('split');
    expect(parsed!.confidence).toBe('med');
    expect(parsed!.rootCause).toContain('과대 페이즈');
  });

  test('마지막 [DIAGNOSIS] 항목 우선(rerun 후 최신 세대) · 무관 note 무시', () => {
    const d1 = buildDiagnosisNote(synthesizePhaseDiagnosis({ ...OUTCOME, failClass: 'transient' }), 'transient');
    const d2 = buildDiagnosisNote(synthesizePhaseDiagnosis(OUTCOME), 'budget-exhausted');
    const parsed = parseDiagnosisNote(['[SE-PR] https://x', d1, '[PROGRESS] 재시도', d2]);
    expect(parsed!.failClass).toBe('budget-exhausted');
  });

  test('진단 note 없음 → null', () => {
    expect(parseDiagnosisNote(['[SE-PR] https://x', '일반 노트'])).toBeNull();
    expect(parseDiagnosisNote([])).toBeNull();
  });
});
