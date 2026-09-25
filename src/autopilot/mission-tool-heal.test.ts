// dispatchAutopilotMissions 힐 액션 3종(split/skip/revise) 개방 계약 (P2 · 2026-07-13).
// 리프 함수(skipPhase/splitPhaseIntoSubphases/spawnMissionPrepare)는 자체 유닛이 검증 —
// 여기는 단일 창구의 인자 검증·페이즈 해석 규약(에러 경로·부작용 없음)만 고정한다.
import { test, expect, describe } from 'bun:test';
import { dispatchAutopilotMissions } from './mission-tool.js';

const err = (r: unknown): string => String((r as { error?: string }).error ?? '');

describe('힐 액션 인자 검증 — 단일 창구 규약', () => {
  test('split/skip — id 없으면 에러', async () => {
    expect(err(await dispatchAutopilotMissions({ action: 'split' }))).toContain('id');
    expect(err(await dispatchAutopilotMissions({ action: 'skip' }))).toContain('id');
  });

  test('split/skip — phase 없으면 에러(phases 안내)', async () => {
    const r1 = await dispatchAutopilotMissions({ action: 'split', id: 'apm_none_x' });
    expect(err(r1)).toContain('phase');
    const r2 = await dispatchAutopilotMissions({ action: 'skip', id: 'apm_none_x' });
    expect(err(r2)).toContain('phase');
  });

  test('split/skip — 존재하지 않는 페이즈 ref 는 "페이즈 없음"(부작용 0)', async () => {
    const r = await dispatchAutopilotMissions({ action: 'skip', id: 'apm_none_x', phase: '3' });
    expect(err(r)).toContain('페이즈 없음');
  });

  test('log — id 없으면 에러 · 미실행 미션은 exists:false(fail-soft)', async () => {
    expect(err(await dispatchAutopilotMissions({ action: 'log' }))).toContain('id');
    const r = await dispatchAutopilotMissions({ action: 'log', id: 'apm_definitely_missing_xyz' }) as
      { ok?: boolean; exists?: boolean; runLogPath?: string };
    expect(r.ok).toBe(true);
    expect(r.exists).toBe(false);
    expect(String(r.runLogPath)).toContain('run.log');
  });

  test('revise — comment 없으면 에러(정정 지시 필수)', async () => {
    expect(err(await dispatchAutopilotMissions({ action: 'revise' }))).toContain('id');
    const r = await dispatchAutopilotMissions({ action: 'revise', id: 'apm_none_x' });
    expect(err(r)).toContain('comment');
  });

  test('revise-suggest — id 없으면 에러', async () => {
    expect(err(await dispatchAutopilotMissions({ action: 'revise-suggest' }))).toContain('id');
  });

  test('revise-suggest — context 맥락으로 추천 생성(READ-ONLY·부작용 0·트리거 안 함)', async () => {
    // NODE_ENV=test → LLM classify 미주입(휴리스틱). 없는 미션도 fail-soft 로 빈 관측 → 맥락 기반 추천.
    const r = await dispatchAutopilotMissions({ action: 'revise-suggest', id: 'apm_none_x', context: 'X 기능은 제외하고 재분해' }) as
      { ok?: boolean; shouldRevise?: boolean; reviseKind?: string; comment?: string; source?: string };
    expect(r.ok).toBe(true);
    expect(r.shouldRevise).toBe(true);
    expect(r.reviseKind).toBe('revise-scope');
    expect(r.comment).toContain('X 기능');
    expect(r.source).toBe('heuristic');
  });

  test('revise-suggest — 맥락·실패페이즈 없으면 정정 불필요', async () => {
    const r = await dispatchAutopilotMissions({ action: 'revise-suggest', id: 'apm_none_x' }) as
      { ok?: boolean; shouldRevise?: boolean };
    expect(r.ok).toBe(true);
    expect(r.shouldRevise).toBe(false);
  });
});
