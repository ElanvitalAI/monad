export interface DashboardApproverRuntimeBootDeps {
  // 주입 setter — 호출측(index.ts)이 구체 타입 함수를 넘긴다. method 문법(bivariant
  // 파라미터)이 DI 콜백의 올바른 variance 모델: setter 슬롯은 타입-agnostic 이되
  // 넘겨받는 구체 함수를 그대로 수용(unknown property-arrow 는 contravariant 로 튕김).
  setShellApprover(approver: unknown): void;
  createShellApprover(): unknown;
  setCodeEditApprover(approver: unknown): void;
  createCodeEditApprover(): unknown;
  setAskUserQuestionDeps(deps: {
    coordinator: unknown;
    termSize: () => { cols: number; rows: number };
  } | null): void;
  setWorktreeRuntimeDeps(deps: {
    sessionId: () => string;
  }): void;
  coordinator: unknown;
  termSize: () => { cols: number; rows: number };
  sessionId: () => string;
}

export function bootDashboardApproverRuntimes(
  deps: DashboardApproverRuntimeBootDeps,
): void {
  deps.setShellApprover(deps.createShellApprover());
  deps.setCodeEditApprover(deps.createCodeEditApprover());
  deps.setAskUserQuestionDeps({
    coordinator: deps.coordinator,
    termSize: deps.termSize,
  });
  deps.setWorktreeRuntimeDeps({
    sessionId: deps.sessionId,
  });
}
