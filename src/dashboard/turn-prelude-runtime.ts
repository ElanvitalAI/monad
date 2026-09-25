import { createSearchPlannerState, type SearchPlannerState } from '../session-runtime/index.js';

export interface DashboardTurnPreludeRuntimeDeps {
  userText: string;
  startUndoTurn: (label: string) => void;
}

export interface DashboardTurnPreludeRuntimeResult {
  searchPlannerState: SearchPlannerState;
}

export function runDashboardTurnPrelude(
  deps: DashboardTurnPreludeRuntimeDeps,
): DashboardTurnPreludeRuntimeResult {
  deps.startUndoTurn(deps.userText.slice(0, 80) || 'turn');
  const structuralAnalysisTurn = /debug|디버그|structure|architecture|구조|분석/i.test(deps.userText);
  return {
    searchPlannerState: createSearchPlannerState({
      maxAutoNarrowCandidates: structuralAnalysisTurn ? 3 : 2,
    }),
  };
}
