import { test, expect, describe } from 'bun:test';
import { buildMissionHistory, formatMissionHistory } from './mission-history.js';

const row = (ts: string, category: string, event: string, data: object) => ({ ts, category, event, data: JSON.stringify(data) });

describe('buildMissionHistory — 종합 히스토리 합성(Track B)', () => {
  const readers = {
    logsReader: () => [
      row('2026-07-15T03:00:00Z', 'mission.selfheal.edit', 'event', { rationale: '[operator·skip-phase] canary — 기능 제외', refs: { op: 'skip-phase' } }),
      row('2026-07-15T01:00:00Z', 'mission.selfheal.decision', 'inject', { rationale: '[operator·re-ground] A1 crit2 arming', refs: { kind: 're-ground' } }),
      row('2026-07-15T02:00:00Z', 'mission.arc.split', 'phase-split', { recommendation: '', arcId: 'a1' }),
      row('2026-07-15T02:30:00Z', 'mission.arc.drift', 'over-bundled', { recommendation: '아크 크기 오판·split 2회' }),
    ],
    revisions: () => [{ ts: '2026-07-15T00:30:00Z', summary: '범위축소: 전이확률 제외' }],
    externalReader: () => [],
  };

  test('시간순 통합·kind 분류', () => {
    const h = buildMissionHistory('apm_x', readers);
    expect(h).toHaveLength(5);
    // 시간순 정렬 — revision(00:30) 이 맨 앞
    expect(h[0]!.kind).toBe('revision');
    expect(h[1]!.kind).toBe('decision'); // 01:00
    expect(h[2]!.kind).toBe('split'); // 02:00
    expect(h[3]!.kind).toBe('drift'); // 02:30
    expect(h[4]!.kind).toBe('edit'); // 03:00 skip
  });

  test('op 추출 — refs.op / refs.kind', () => {
    const h = buildMissionHistory('apm_x', readers);
    expect(h.find((e) => e.kind === 'edit')!.op).toBe('skip-phase');
    expect(h.find((e) => e.kind === 'decision')!.op).toBe('re-ground');
  });

  test('formatMissionHistory — 요약 롤업', () => {
    const s = formatMissionHistory('apm_x', buildMissionHistory('apm_x', readers));
    expect(s).toContain('종합 히스토리');
    expect(s).toContain('skip-phase');
    expect(s).toContain('요약:');
  });

  test('빈 히스토리 안내', () => {
    const s = formatMissionHistory('apm_y', buildMissionHistory('apm_y', { logsReader: () => [], revisions: () => [], externalReader: () => [] }));
    expect(s).toContain('종합 히스토리 없음');
  });

  test('★ 외부 변경(claude-code PR) 합류 + provenance(RFC L1)', () => {
    const h = buildMissionHistory('apm_x', {
      logsReader: () => [],
      revisions: () => [],
      externalReader: () => [
        { ts: '2026-07-15T04:00:00Z', tool: 'claude-code', kind: 'fix', summary: '방향 오분류 근본수정', refs: { pr: '4276' } },
      ],
    });
    expect(h).toHaveLength(1);
    expect(h[0]!.kind).toBe('external');
    expect(h[0]!.provenance).toBe('🔧 claude-code');
    expect(h[0]!.summary).toContain('#4276');   // PR 번호 노출
    const s = formatMissionHistory('apm_x', h);
    expect(s).toContain('🔧');                    // 외부 아이콘
  });
});
