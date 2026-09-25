// 분해 크래시 조회 순수 파싱/포맷 단위테스트.
import { describe, it, expect } from 'bun:test';
import { parseCrashLines, formatCrashEntry, type DecomposeCrashEntry } from '../src/autopilot/decompose-crash-log.js';

const rec = (over: Partial<DecomposeCrashEntry>): string => JSON.stringify({ ts: '2026-07-16T00:00:00Z', missionId: 'm1', ...over });

describe('parseCrashLines', () => {
  it('missionId 필터 + 최근 우선 + limit', () => {
    const lines = [rec({ missionId: 'm1', code: 'A' }), rec({ missionId: 'm2', code: 'B' }), rec({ missionId: 'm1', code: 'C' })];
    const r = parseCrashLines(lines, { missionId: 'm1', limit: 5 });
    expect(r).toHaveLength(2);
    expect(r[0].code).toBe('C'); // 최근 우선(reverse)
  });
  it('깨진 라인 skip', () => {
    const r = parseCrashLines(['not json', rec({ code: 'X' }), ''], {});
    expect(r).toHaveLength(1);
    expect(r[0].code).toBe('X');
  });
  it('limit 로 최근 N건만', () => {
    const lines = Array.from({ length: 8 }, (_, i) => rec({ code: `c${i}` }));
    expect(parseCrashLines(lines, { limit: 3 })).toHaveLength(3);
  });
});

describe('formatCrashEntry', () => {
  it('code·validationErrors·rawTextHead 포맷', () => {
    const s = formatCrashEntry({
      ts: '2026-07-16T00:00:00Z', missionId: 'm1', code: 'VALIDATION_FAILED', model: 'gpt-5.6-sol', rawTextChars: 11253,
      message: 'schema violation', validationErrors: [{ code: 'TASK_SHAPE', taskIndex: 0, message: 'acceptance.checks invalid' }],
      rawTextHead: '{"rationale":"...',
    });
    expect(s).toContain('VALIDATION_FAILED');
    expect(s).toContain('gpt-5.6-sol');
    expect(s).toContain('[TASK_SHAPE#0] acceptance.checks invalid');
    expect(s).toContain('rawTextHead');
  });
  it('validationErrors 없으면 (없음)', () => {
    expect(formatCrashEntry({ ts: 't', missionId: 'm1' })).toContain('(없음)');
  });
});
