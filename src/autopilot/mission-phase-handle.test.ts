import { describe, it, expect } from 'bun:test';
import type { MissionArc } from '../task-orchestrator/mission.js';
import {
  phaseHashTag, arcOrdinalTag, arcHandle, phaseHandle, arcIdxForPhase,
} from './mission-phase-handle.js';

const arc = (arcId: string, phaseIds: string[]): MissionArc => ({
  arcId, name: 'n', intent: 'i', phaseIds, dependsOnArcs: [], acceptance: [], status: 'pending',
});

describe('phaseHashTag', () => {
  it('task: 접두 제거 후 앞 4 hex', () => {
    expect(phaseHashTag('task:2cecd81912c0')).toBe('2cec');
  });
  it('접두 없어도 동작·비hex 방어', () => {
    expect(phaseHashTag('7f3a9b')).toBe('7f3a');
    expect(phaseHashTag('task:')).toBe('????');
  });
});

describe('arcOrdinalTag', () => {
  it('0-based idx → 1-based A태그', () => {
    expect(arcOrdinalTag(0)).toBe('A1');
    expect(arcOrdinalTag(1)).toBe('A2');
  });
});

describe('arcHandle', () => {
  it('A<idx+1>·라틴슬러그(소문자·5자)', () => {
    expect(arcHandle(arc('arc_docops-supersede_1', []), 1)).toBe('A2·docop');
  });
  it('슬러그가 전부 비라틴이면 순번만', () => {
    expect(arcHandle(arc('arc_임베딩판정_2', []), 2)).toBe('A3');
  });
});

describe('phaseHandle — 재발급 경계', () => {
  it('arcIdx 있으면 A<arc>·<hash>·g<gen>', () => {
    expect(phaseHandle({ taskId: 'task:2cecd81912c0', arcIdx: 1, generation: 5 })).toBe('A2·2cec·g5');
  });
  it('arcIdx 없으면(flat) <hash>·g<gen>', () => {
    expect(phaseHandle({ taskId: 'task:2cecd81912c0', generation: 0 })).toBe('2cec·g0');
  });
  it('generation 미지정 → g0', () => {
    expect(phaseHandle({ taskId: 'task:aaaa1111', arcIdx: 0 })).toBe('A1·aaaa·g0');
  });
  it('rebuild(gen++) → 핸들 변경·계보(hash) 유지', () => {
    const g5 = phaseHandle({ taskId: 'task:2cecd8', arcIdx: 1, generation: 5 });
    const g6 = phaseHandle({ taskId: 'task:2cecd8', arcIdx: 1, generation: 6 });
    expect(g5).not.toBe(g6);
    expect(g5).toBe('A2·2cec·g5'); expect(g6).toBe('A2·2cec·g6'); // 2cec 유지
  });
  it('revise(새 task.id) → 완전 새 핸들', () => {
    const before = phaseHandle({ taskId: 'task:2cecd8', arcIdx: 1, generation: 6 });
    const after = phaseHandle({ taskId: 'task:7f3a9b', arcIdx: 1, generation: 6 });
    expect(before).not.toBe(after);
    expect(after).toBe('A2·7f3a·g6');
  });
  it('상태변화(같은 taskId·gen) → 핸들 유지(지칭 안정)', () => {
    const a = phaseHandle({ taskId: 'task:2cecd8', arcIdx: 1, generation: 5 });
    const b = phaseHandle({ taskId: 'task:2cecd8', arcIdx: 1, generation: 5 });
    expect(a).toBe(b);
  });
});

describe('arcIdxForPhase', () => {
  const arcs = [arc('arc_a_0', ['task:p1', 'task:p2']), arc('arc_b_1', ['task:p3'])];
  it('페이즈 소속 아크 순번(0-based)', () => {
    expect(arcIdxForPhase(arcs, 'task:p3')).toBe(1);
    expect(arcIdxForPhase(arcs, 'task:p1')).toBe(0);
  });
  it('미소속/flat → undefined', () => {
    expect(arcIdxForPhase(arcs, 'task:zzz')).toBeUndefined();
    expect(arcIdxForPhase(undefined, 'task:p1')).toBeUndefined();
    expect(arcIdxForPhase([], 'task:p1')).toBeUndefined();
  });
});
