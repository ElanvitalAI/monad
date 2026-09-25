// Scoped-analysis keyword detection — fix W (2026-04-25).
// Reference: 내부 문서 `RESEARCH-codex-reread-pathology-2refs-2026-04-25` fix W.
// Pre-fix W the heuristic missed Korean/English project-evaluation
// vocabulary, so analytic prompts like "이 프로젝트 현재 코딩 에이전트
// 구현 정도 평가해주세요" never unlocked the auto-narrow path —
// codex stalled in search-loop instead of receiving the
// inspect-synthesis-armed fallback.

import { describe, expect, test } from 'bun:test';
import { isScopedAnalysisRequest } from '../src/session-runtime/index.js';

describe('isScopedAnalysisRequest — keyword coverage', () => {
  test('recognized — pre-existing subsystem-analysis vocabulary still matches', () => {
    expect(isScopedAnalysisRequest('analyze the chat-input subsystem')).toBe(true);
    expect(isScopedAnalysisRequest('explain the architecture of code-edit')).toBe(true);
    expect(isScopedAnalysisRequest('이 컴포넌트 구조 분석해줘')).toBe(true);
  });

  test('recognized — pre-existing runtime/debug vocabulary still matches', () => {
    expect(isScopedAnalysisRequest('debug the dashboard render flow')).toBe(true);
    expect(isScopedAnalysisRequest('trace the logger call path')).toBe(true);
    expect(isScopedAnalysisRequest('이 디버그 출력 진단해줘')).toBe(true);
  });

  test('recognized — new project-evaluation vocabulary (fix W)', () => {
    // Reproducer prompt that triggered the codex stall pre-W.
    expect(isScopedAnalysisRequest('이 프로젝트 현재 코딩 에이전트 구현 정도 평가해주세요')).toBe(true);
    expect(isScopedAnalysisRequest('evaluate the codebase maturity')).toBe(true);
    expect(isScopedAnalysisRequest('audit the implementation status')).toBe(true);
    expect(isScopedAnalysisRequest('현황 정리해줘')).toBe(true);
    expect(isScopedAnalysisRequest('진척도 알려줘')).toBe(true);
    expect(isScopedAnalysisRequest('성숙도가 어느 정도야')).toBe(true);
  });

  test('not recognized — generic chat / unrelated requests', () => {
    expect(isScopedAnalysisRequest('hello')).toBe(false);
    expect(isScopedAnalysisRequest('write me a poem')).toBe(false);
    expect(isScopedAnalysisRequest('summarize this URL')).toBe(false);
    expect(isScopedAnalysisRequest('')).toBe(false);
    expect(isScopedAnalysisRequest(undefined)).toBe(false);
  });
});

describe('dispatchSessionRuntimeTool — codex family forces scoped-analysis (fix W-bis)', () => {
  test('codex family enables scoped narrowing even when userText misses every keyword', async () => {
    const { dispatchSessionRuntimeTool } = await import('../src/session-runtime/index.js');
    const plannerState: {
      phase: 'idle' | 'listed' | 'inspecting';
      pendingCandidateScopeKey: string | null;
      suggestedCandidates: string[];
      nextCandidateIndex: number;
      maxAutoNarrowCandidates: number;
    } = {
      phase: 'idle',
      pendingCandidateScopeKey: null,
      suggestedCandidates: [],
      nextCandidateIndex: 0,
      maxAutoNarrowCandidates: 2,
    };
    // userText that does NOT match any keyword in isScopedAnalysisRequest.
    // Pre-W-bis this would leave scopedAnalysis=false → planner stays
    // idle → no auto-narrow ever fires.
    await dispatchSessionRuntimeTool('Grep', {
      pattern: 'foo|bar',
      path: 'src',
      glob: '**/*.ts',
      output_mode: 'files_with_matches',
    }, {
      userText: 'hello there',  // generic, no keyword match
      modelFamily: 'codex',     // family forces scoped path
      searchPlannerState: plannerState,
      isSchedulerTool: () => false,
      dispatchSchedulerTool: async () => 'scheduler',
      getToolRuntime: () => undefined,
      dispatchToolRuntime: async () => 'runtime',
      dispatchPluginTool: async () => ({ ok: true, result: 'plugin' }),
    });
    // Planner advanced to 'listed' state — proves the codex always-on
    // path engaged.
    expect(plannerState.phase).toBe('listed');
    expect(plannerState.pendingCandidateScopeKey).not.toBeNull();
  });

  test('non-codex family with no keyword match keeps planner idle (back-compat)', async () => {
    const { dispatchSessionRuntimeTool } = await import('../src/session-runtime/index.js');
    const plannerState: {
      phase: 'idle' | 'listed' | 'inspecting';
      pendingCandidateScopeKey: string | null;
      suggestedCandidates: string[];
      nextCandidateIndex: number;
      maxAutoNarrowCandidates: number;
    } = {
      phase: 'idle',
      pendingCandidateScopeKey: null,
      suggestedCandidates: [],
      nextCandidateIndex: 0,
      maxAutoNarrowCandidates: 2,
    };
    await dispatchSessionRuntimeTool('Grep', {
      pattern: 'foo|bar',
      path: 'src',
      glob: '**/*.ts',
      output_mode: 'files_with_matches',
    }, {
      userText: 'hello there',
      modelFamily: 'claude',  // claude self-regulates, dictionary opt-in
      searchPlannerState: plannerState,
      isSchedulerTool: () => false,
      dispatchSchedulerTool: async () => 'scheduler',
      getToolRuntime: () => undefined,
      dispatchToolRuntime: async () => 'runtime',
      dispatchPluginTool: async () => ({ ok: true, result: 'plugin' }),
    });
    // Claude path unchanged — planner stays idle when keywords miss.
    expect(plannerState.phase).toBe('idle');
    expect(plannerState.pendingCandidateScopeKey).toBeNull();
  });
});
