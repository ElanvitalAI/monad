import { describe, it, expect } from 'bun:test';
import type { MissionArc } from '../task-orchestrator/mission.js';
import { formatArcCompact, formatArcAutoproceedNotice } from './mission-notify.js';

const arc = (o: Partial<MissionArc> & { arcId: string; name: string }): MissionArc => ({
  intent: 'x', phaseIds: ['p1'], dependsOnArcs: [], acceptance: [], status: 'pending', ...o,
});

describe('formatArcCompact — preflight 판정 근거 표면화 (갭3·대표 2026-07-20)', () => {
  it('mirage reason 을 플래그 옆에 표면화(종전 ⚠️mirage 만·근거 없어 오탐 판별 불가)', () => {
    const arcs = [
      arc({ arcId: 'a0', name: '계약 확정', phaseIds: ['p1'] }),
      arc({ arcId: 'a1', name: '구현', phaseIds: ['p2'], preflightVerdict: { verdict: 'mirage', reason: '지목 파일이 아크 의도와 무관', action: 'descope' } }),
    ];
    const out = formatArcCompact(arcs);
    expect(out).toContain('⚠️mirage');
    expect(out).toContain('지목 파일'); // reason 표면화
  });

  it('아주 긴 reason 은 220자+… 로 절단(#4857 후속·판정 근거 잘림 방지, 상한만 균형)', () => {
    const arcs = [
      arc({ arcId: 'a0', name: 'A', phaseIds: ['p1'] }),
      arc({ arcId: 'a1', name: 'B', phaseIds: ['p2'], preflightVerdict: { verdict: 'over_scope', reason: '가'.repeat(250), action: 'narrow' } }),
    ];
    expect(formatArcCompact(arcs)).toContain('…');
  });

  it('중간 길이 reason(약 90~200자)은 절단 안 함(종전 90자 컷이 근거를 잘라 오탐 판별 불가했음)', () => {
    const reason = '지목 파일이 아크 의도와 무관하고 grounding 에도 두 파일 다 없어 허상으로 판정. 재조사 필요.'.repeat(2);
    const arcs = [
      arc({ arcId: 'a0', name: 'A', phaseIds: ['p1'] }),
      arc({ arcId: 'a1', name: 'B', phaseIds: ['p2'], preflightVerdict: { verdict: 'mirage', reason, action: 'descope' } }),
    ];
    const out = formatArcCompact(arcs);
    expect(out).toContain(reason); // 온전히 표면화(짤림 없음)
    expect(out).not.toContain('…');
  });

  it('founded 아크는 플래그 없음(정상은 조용히)', () => {
    const arcs = [
      arc({ arcId: 'a0', name: 'A', phaseIds: ['p1'] }),
      arc({ arcId: 'a1', name: 'B', phaseIds: ['p2'], preflightVerdict: { verdict: 'founded', reason: 'ok', action: 'keep' } }),
    ];
    expect(formatArcCompact(arcs)).not.toContain('⚠️');
  });

  it('아크 1개 이하는 빈 문자열(flat 은 규모줄로 충분)', () => {
    expect(formatArcCompact([arc({ arcId: 'a0', name: 'A' })])).toBe('');
    expect(formatArcCompact([])).toBe('');
  });
});

describe('formatArcAutoproceedNotice — 아크 자율 산정 non-blocking 알림(#4867 후속·투명성 갭·2026-07-21)', () => {
  it('arcHint 있으면 채택 아크 수를 명시(자율 진행 통지)', () => {
    const out = formatArcAutoproceedNotice(3);
    expect(out).toContain('아크 3개로');
    expect(out).toContain('자율 진행');
  });

  it('arcHint 없으면(분해기 재량) 수 대신 재량 문구', () => {
    const out = formatArcAutoproceedNotice(undefined);
    expect(out).toContain('분해기 재량');
    expect(out).not.toMatch(/아크 \d+개/);
  });

  it('상세 구성은 분해 완료 후 승인 카드로 안내(intake 시점엔 아크 이름 미정)', () => {
    const out = formatArcAutoproceedNotice(5);
    expect(out).toContain('분해 완료 후');
    expect(out).toContain('승인 카드');
  });

  it('ASCII 제어문자 없이 두 줄(간결)', () => {
    expect(formatArcAutoproceedNotice(4).split('\n').length).toBe(2);
  });
});
