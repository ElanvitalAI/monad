import { describe, it, expect } from 'bun:test';
import {
  parseWorkingMemoryJsonl, formatWorkingMemoryForPrompt, type WorkingMemoryEntry,
} from './mission-working-memory.js';

function entry(p: Partial<WorkingMemoryEntry>): WorkingMemoryEntry {
  return {
    phaseId: 'task:x', phaseTitle: 't', kind: 'implementation', at: '2026-07-14T00:00:00Z',
    summary: 's', reusables: [], decisions: [], artifacts: [], provenance: 'self', ...p,
  };
}

describe('아크 메모리 arcId round-trip (버그 수복)', () => {
  it('parseWorkingMemoryJsonl 이 arcId 를 보존한다 (append→read)', () => {
    const line = JSON.stringify({
      phaseId: 'task:a', phaseTitle: '배선', kind: 'implementation', at: '2026-07-14T00:00:00Z',
      summary: 'observeCoordinatorAccount 배선', reusables: ['coordinator-mission:observeCoordinatorAccount'],
      decisions: [], artifacts: [], provenance: 'self', arcId: 'arc_관측계약_0',
    });
    const parsed = parseWorkingMemoryJsonl(line);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.arcId).toBe('arc_관측계약_0');  // ← 이전엔 undefined(드롭)였음
  });

  it('arcId 없는 레거시 줄은 arcId undefined (하위호환)', () => {
    const line = JSON.stringify({ phaseId: 'task:b', summary: 's', reusables: [] });
    expect(parseWorkingMemoryJsonl(line)[0]!.arcId).toBeUndefined();
  });
});

describe('아크메이트/아크간 컨텍스트 교환 (formatWorkingMemoryForPrompt)', () => {
  const entries = [
    entry({ phaseId: 'p0', phaseTitle: '조사', kind: 'investigation', arcId: 'arc0', summary: '조사 완료', reusables: ['regime:computeRegime'] }),
    entry({ phaseId: 'p-wire', phaseTitle: '배선', arcId: 'arcObs', summary: '관측 배선', reusables: ['coordinator-mission:observeCoordinatorAccount'], decisions: ['읽기전용 스냅샷 계약'] }),
  ];

  it('같은 아크(arcObs) 페이즈엔 아크메이트 계약 강조 + worktree 경고', () => {
    const s = formatWorkingMemoryForPrompt(entries, { arcId: 'arcObs' });
    expect(s).toContain('같은 아크(arcObs)');
    expect(s).toContain('observeCoordinatorAccount');
    expect(s).toContain('self-contained');  // 재구현 금지 경고
    expect(s).toContain('격리 worktree');
  });

  it('다른 아크(arc0)는 이전 아크 경계 요약으로 교환', () => {
    const s = formatWorkingMemoryForPrompt(entries, { arcId: 'arcObs' });
    expect(s).toContain('이전 아크가 닫은 산출');
    expect(s).toContain('arc0');
    expect(s).toContain('computeRegime');
  });

  it('arcId 미지정(flat)이면 아크 블록 없음 (회귀 0)', () => {
    const s = formatWorkingMemoryForPrompt(entries);
    expect(s).not.toContain('같은 아크');
    expect(s).not.toContain('이전 아크가 닫은');
  });
});
