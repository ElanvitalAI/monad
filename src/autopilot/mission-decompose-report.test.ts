// 분해 분석 리포트 단위테스트 — 순수 Markdown 빌더 + 워킹메모리 다이제스트(축B).
import { describe, it, expect } from 'bun:test';
import { buildDecompositionReport, decompositionReportDigest, type DecompReportInput } from './mission-decompose-report.js';
import type { MissionArc } from '../task-orchestrator/mission.js';

const arc = (over: Partial<MissionArc>): MissionArc => ({
  arcId: 'arc_x_0', name: '아크', intent: '', phaseIds: [], dependsOnArcs: [], acceptance: [], status: 'pending', ...over,
});

const INPUT: DecompReportInput = {
  goal: '콘텐츠를 흡수해 요약한다',
  arcs: [
    arc({ arcId: 'arc_ob_0', name: '관측', intent: '입력 파악', phaseIds: ['t1', 't2'], dependsOnArcs: [], acceptance: ['입력 계약 배선됨'] }),
    arc({ arcId: 'arc_ex_1', name: '집행', intent: '요약 생성', phaseIds: ['t3'], dependsOnArcs: ['arc_ob_0'], acceptance: [] }),
  ],
  phaseTitles: { t1: '입력 조사', t2: '제약 수집', t3: '요약 구현' },
  arcHint: 2,
};

describe('buildDecompositionReport', () => {
  it('아크 구조·의도·페이즈명·선행·acceptance 렌더', () => {
    const md = buildDecompositionReport(INPUT);
    expect(md).toContain('# 분해 분석 — 콘텐츠를 흡수해 요약한다');
    expect(md).toContain('아크 2개 · 페이즈 3개 · arcHint 2');
    expect(md).toContain('### A1 · 관측');
    expect(md).toContain('페이즈 (2): 입력 조사 · 제약 수집');
    expect(md).toContain('선행 아크: 관측');          // arcId → name 매핑
    expect(md).toContain('입력 계약 배선됨');
    expect(md).toContain('(없음·페이즈 로컬만)');       // acceptance 빈 아크
  });

  it('preflight 경고(founded 아님)만 표기', () => {
    const md = buildDecompositionReport({ ...INPUT, arcs: [
      arc({ arcId: 'a0', name: '허상', phaseIds: ['t1'], preflightVerdict: { verdict: 'mirage', reason: 'r', action: 'descope' } }),
      arc({ arcId: 'a1', name: '정상', phaseIds: ['t2'], dependsOnArcs: ['a0'], preflightVerdict: { verdict: 'founded', reason: 'r', action: 'keep' } }),
    ] });
    expect(md).toContain('⚠️ preflight: mirage→descope');
    expect(md).not.toContain('founded');               // founded 는 표기 안 함
  });

  it('critique 되먹임 이력(있으면)', () => {
    const md = buildDecompositionReport({ ...INPUT, critique: { rounds: 2, residualCritical: 1 } });
    expect(md).toContain('자동 정련 2회 · 잔여 치명 1건');
  });
});

describe('decompositionReportDigest — 워킹메모리 각인용(축B)', () => {
  it('아크 체인·페이즈·arcHint 요약', () => {
    expect(decompositionReportDigest(INPUT)).toBe('분해: 아크 2개(관측→집행) · 페이즈 3개 · arcHint 2');
  });
  it('preflight 경고·되먹임 이력 반영', () => {
    const d = decompositionReportDigest({ ...INPUT,
      arcs: [arc({ arcId: 'a0', name: '허상', phaseIds: ['t1'], preflightVerdict: { verdict: 'mirage', reason: 'r', action: 'descope' } }), arc({ arcId: 'a1', name: '정상', phaseIds: ['t2'] })],
      critique: { rounds: 1, residualCritical: 0 },
    });
    expect(d).toContain('정련 1회·잔여치명 0');
    expect(d).toContain('⚠️preflight 경고 1');
  });
});
