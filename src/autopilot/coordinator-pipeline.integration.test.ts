import { test, expect, describe } from 'bun:test';
import {
  buildObservedSignalEnvelope,
  classifySignalQuality,
  publishSignalQualityStates,
  buildEvidenceBundle,
  buildResearchEntryInput,
  handoffResearchEntry,
  routeResearchLens,
  type EvidenceObservation,
  type ResearchEntryInput,
} from './coordinator-mission.js';

// ── A1 아크 통합 검증(e2e) — 관측→품질→근거묶음→반응형 렌즈→판단 진입 계약 ──
//   PLAN-arc-phase-lifecycle-editing §7 D4·통합 실체화(대표 2026-07-15). A1 acceptance:
//   ①관측신호→근거묶음→렌즈 라우팅(추적 식별자 유지) 통합테스트 ②저품질/누락/충돌 반영
//   ③렌즈 심화 근거가 다음 판단 단계 계약으로 게시. 조각(페이즈 0~10)이 하나의 pipeline 으로
//   정합함을 종단 간 증명한다(아크 통합 정합성 = 페이즈 로컬이 놓치는 것).

const NOW = new Date('2026-07-15T00:00:00Z');
const FRESH = '2026-07-14T23:59:30Z';

function obs(
  subject: string, value: unknown, quality: 'normal' | 'delayed' | 'missing' | 'error',
  kind: 'fact' | 'inference' = 'fact',
  opts: { source?: string; ttlMs?: number; sourceAccessible?: boolean; observedAt?: string } = {},
): EvidenceObservation {
  const envelope = buildObservedSignalEnvelope({
    value, raw: { v: value }, observedAt: opts.observedAt ?? FRESH,
    source: opts.source ?? `src:${subject}`, unit: 'x', confidence: 0.9, ttlMs: opts.ttlMs ?? 60_000,
    qualityState: quality,
  });
  return { subject, kind, envelope, ...(opts.sourceAccessible !== undefined ? { sourceAccessible: opts.sourceAccessible } : {}) };
}

describe('A1 아크 통합 — coordinator 관측→리서치 pipeline 종단 간', () => {
  test('① pipeline 정합 — 관측→근거묶음→렌즈, 진입 계약이 둘 다 받음(추적=rawHash 계보)', () => {
    const observations = [obs('kospi', 3200, 'normal', 'fact', { source: 'kis' })];
    let captured: ResearchEntryInput | null = null;
    const out = handoffResearchEntry({ severity: 'S4', observations, now: NOW }, (input) => { captured = input; return 'consumed'; });
    expect(out).toBe('consumed'); // ③ 다음 판단 단계가 소비하는 계약으로 게시됨
    expect(captured).not.toBeNull();
    const inp = captured!;
    // 근거묶음 + 렌즈가 한 입력으로 배선(진입점이 둘 다 받음)
    expect(inp.lenses).toEqual(['runGate2', 'runReactiveLens', 'runDig']); // S4 critical
    expect(inp.evidence.facts).toHaveLength(1);
    // 추적 식별자 유지 — 원본 신호의 rawHash 가 근거에 보존(계보 추적 가능)
    expect(inp.evidence.facts[0]!.rawHash).toMatch(/^[0-9a-f]{40}$/);
    expect(inp.evidence.facts[0]!.subject).toBe('kospi');
  });

  test('② 저품질·누락·충돌 신호가 렌즈/라우팅에 실제 반영(dataGaps·conflicts)', () => {
    const observations: EvidenceObservation[] = [
      obs('a', 1, 'normal'),
      obs('missing1', null, 'missing'),
      obs('err1', 2, 'error'),
      obs('stale1', 3, 'delayed'),
      obs('blocked1', 4, 'normal', 'fact', { sourceAccessible: false }),
      obs('dup', 10, 'normal'),
      obs('dup', 20, 'normal', 'fact', { source: 'other' }), // 같은 subject·다른 값 → conflict
    ];
    const bundle = buildEvidenceBundle(observations, NOW);
    const gapSubjects = bundle.dataGaps.map((g) => g.subject);
    expect(gapSubjects).toContain('missing1');   // 결측
    expect(gapSubjects).toContain('err1');        // 오류
    expect(gapSubjects).toContain('stale1');      // 지연/만료
    expect(gapSubjects).toContain('blocked1');    // 접근 불가
    expect(bundle.conflicts.map((c) => c.subject)).toContain('dup'); // 충돌 반영
    // 저품질은 사실/추론에 섞이지 않음(fail-closed 게시)
    expect(bundle.facts.map((f) => f.subject)).not.toContain('err1');
  });

  test('③ 심각도가 렌즈 심화를 실제로 가른다(비판단 이벤트=Gate2만)', () => {
    expect(routeResearchLens(undefined)).toEqual(['runGate2']);
    expect(routeResearchLens('S4')).toEqual(['runGate2', 'runReactiveLens', 'runDig']);
    const shallow = buildResearchEntryInput({ severity: undefined, observations: [obs('x', 1, 'normal')], now: NOW });
    expect(shallow.lenses).toEqual(['runGate2']); // 심각 아니면 심화 안 함
  });

  test('관측 스파인과 결합 — 품질 판정기·게시가 근거 gap 분류와 정합', () => {
    // classifySignalQuality → 미래 시각은 error → 게시 → 근거묶음 gap
    const q = classifySignalQuality({ value: 1, observedAt: '2027-01-01T00:00:00Z', now: NOW, ttlMs: 60_000 });
    expect(q).toBe('error');
    const published = publishSignalQualityStates({ community: { value: null, observedAt: FRESH } }, NOW);
    expect(published.find((p) => p.slot === 'community')!.qualityState).toBe('missing');
    // 게시된 결측 상태가 근거묶음에서 dataGap 으로 이어짐(파이프라인 정합)
    const bundle = buildEvidenceBundle([obs('community', null, 'missing')], NOW);
    expect(bundle.dataGaps.map((g) => g.subject)).toContain('community');
  });
});
