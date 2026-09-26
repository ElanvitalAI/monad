// agent-loop-substrate 조각3 — 결정론적 teardown 계약 (lifecycle 종료 자원 회수) 2026-07-19
//
// ★ RESEARCH-orchestrator-free-system-core #6. 조율자 유무 무관 "lifecycle 종료 시 결정론적 자원 회수"
//   substrate 프리미티브. Claude Code runAgent.ts:816-859 `finally`(자식 프로세스 kill·MCP cleanup·캐시/hook/
//   todos 해제) 동형 — orchestrator 없으면 각 루프가 자기 finally 에서 청소해야 한다. elanous 는 run-lock·
//   pending-write 회수가 **산재·부분** → 이 계약이 등록형 teardown 스택으로 통일(어느 종료 경로든 1회 실행).
//
// ★ 제1원칙 3박자(대표 지시 2026-07-19): ①관측 — run()이 스텝별 결과(ok/error) 반환·caller 방출. ②자기인지 —
//   ok/failed 카운트+사유로 "무엇이 청소됐고 뭐가 실패했나" 인지. ③셀프힐 — 각 핸들러 fail-soft 격리(하나
//   실패가 나머지 청소를 막지 않음=좀비 잔존 방지) + 1회 실행 보장(중복 teardown 방지). LIFO(마지막 획득
//   자원 먼저 해제) — defer/finally 스택 관례.

/** teardown 스텝 결과 — 관측/자기인지용. */
export interface TeardownStepResult { name: string; ok: boolean; error?: string; }

/** run() 종합 결과 — caller 가 관측 방출·자기인지. */
export interface TeardownResult {
  reason: string;
  steps: TeardownStepResult[];
  okCount: number;
  failedCount: number;
  /** 이미 실행된 계약을 재실행하려 했나(중복 teardown 방지·no-op). */
  alreadyRun: boolean;
}

export interface TeardownContract {
  /** 자원 해제 핸들러 등록(획득 시점). name=관측/자기인지 라벨. LIFO 로 실행. */
  register(name: string, fn: () => void | Promise<void>): void;
  /** 전 핸들러를 LIFO 로 fail-soft 실행(1회만·이후 no-op). reason=종료 사유(완료/취소/에러). */
  run(reason: string): Promise<TeardownResult>;
  /** 등록된 핸들러 수(실행 전). */
  readonly size: number;
  /** 이미 run() 됐나. */
  readonly done: boolean;
}

/**
 * ★ 조각3 — teardown 계약 생성. 루프/미션이 자원 획득 시 register, 종료(완료/취소/에러) 시 run(reason).
 * LIFO·fail-soft 격리·1회 실행. orchestrator 무관(각 루프 로컬 finally 계약) — 대표 원칙 정합.
 */
export function createTeardownContract(): TeardownContract {
  const handlers: Array<{ name: string; fn: () => void | Promise<void> }> = [];
  let hasRun = false;

  return {
    register(name, fn) { handlers.push({ name, fn }); },
    get size() { return handlers.length; },
    get done() { return hasRun; },
    async run(reason): Promise<TeardownResult> {
      if (hasRun) return { reason, steps: [], okCount: 0, failedCount: 0, alreadyRun: true };
      hasRun = true;
      const steps: TeardownStepResult[] = [];
      // LIFO — 마지막 획득 자원 먼저 해제. 각 핸들러 fail-soft 격리(하나 실패가 나머지를 막지 않음).
      for (let i = handlers.length - 1; i >= 0; i--) {
        const h = handlers[i]!;
        try {
          await h.fn();
          steps.push({ name: h.name, ok: true });
        } catch (err) {
          steps.push({ name: h.name, ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }
      handlers.length = 0; // 실행 후 비움(중복 방지·GC)
      return {
        reason, steps,
        okCount: steps.filter((s) => s.ok).length,
        failedCount: steps.filter((s) => !s.ok).length,
        alreadyRun: false,
      };
    },
  };
}
