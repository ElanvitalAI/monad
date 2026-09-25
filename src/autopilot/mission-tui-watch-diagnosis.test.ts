// TUI 워처 진단 카드 렌더 (P4 · 2026-07-13) — 실패 페이즈의 저장 진단([DIAGNOSIS] note)이
// 텔레그램 카드 동형(🧭 진단 + 💡 권장)으로 표시되고, 종결 리포트의 재개 힌트가 권장 힐을
// 구체 명령으로 안내하는지. 순수 렌더러만(스토어 I/O 없음).
import { test, expect, describe } from 'bun:test';
import {
  renderMissionPhaseDiagnosisLines, renderMissionRunReportLines,
  type MissionRunPhase, type MissionRunSnapshot,
} from './mission-tui-watch.js';

const failedPhase: MissionRunPhase = {
  index: 2, id: 'p2', title: '후보 verify-first 검증', status: 'failed', dependsOn: [],
  diagnosis: {
    failClass: 'budget-exhausted',
    narrative: 'P2 실패. 목표: 후보 검증. 시도: terra 1000턴→gate-failed → opus-4.8→gate-failed.',
    rootCause: '과대 페이즈로 실행 예산 초과 추정. (근거: 여러 재시도가 모두 게이트 실패)',
    heal: 'split', confidence: 'med',
  },
};

describe('renderMissionPhaseDiagnosisLines — 진단 카드 동형', () => {
  test('🧭 진단 + 💡 권장(신뢰도·failClass) 2줄', () => {
    const lines = renderMissionPhaseDiagnosisLines(failedPhase);
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('🧭 진단(추정): 과대 페이즈');
    expect(lines[1]).toContain('✂️ 분할');
    expect(lines[1]).toContain('med');
    expect(lines[1]).toContain('budget-exhausted');
  });

  test('진단 없는 페이즈 → 빈 배열(무노이즈)', () => {
    expect(renderMissionPhaseDiagnosisLines({ ...failedPhase, diagnosis: undefined } as MissionRunPhase)).toEqual([]);
  });
});

describe('renderMissionRunReportLines — 진단 포함 종결 리포트', () => {
  const snapshot: MissionRunSnapshot = {
    exists: true, goal: 'g', status: 'running', runLockActive: false,
    phases: [
      { index: 0, id: 'p0', title: 'A', status: 'done', dependsOn: [], prUrl: 'https://x/y/pull/1' },
      failedPhase,
      { index: 3, id: 'p3', title: 'C', status: 'backlog', dependsOn: [] },
    ],
  };

  test('실패 페이즈 아래 진단 줄 + failClass 태그', () => {
    const lines = renderMissionRunReportLines(snapshot);
    const failedIdx = lines.findIndex((l) => l.includes('[failed·budget-exhausted]'));
    expect(failedIdx).toBeGreaterThan(-1);
    expect(lines[failedIdx + 1]).toContain('🧭 진단(추정)');
    expect(lines[failedIdx + 2]).toContain('💡 권장');
  });

  test('재개 힌트가 권장 힐 구체 명령(/mission split <id> 2)로', () => {
    const hint = renderMissionRunReportLines(snapshot).find((l) => l.startsWith('권장:'));
    expect(hint).toBeDefined();
    expect(hint).toContain('/mission split <id> 2');
  });

  test('진단 없는 실패 → 기존 제네릭 재개 힌트 유지', () => {
    const noDiag: MissionRunSnapshot = {
      ...snapshot,
      phases: snapshot.phases.map((p) => (p.id === 'p2' ? { ...p, diagnosis: undefined } as MissionRunPhase : p)),
    };
    const hint = renderMissionRunReportLines(noDiag).find((l) => l.startsWith('재개:'));
    expect(hint).toContain('/mission rebuild');
  });
});
