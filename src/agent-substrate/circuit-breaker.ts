// agent-loop-substrate 조각1 — 자기종료 루프 계약의 circuit breaker (2026-07-19)
//
// ★ RESEARCH-orchestrator-free-system-core #1. 조율자 유무와 무관하게 "무한 재시도/폭주를 끊는" substrate
//   프리미티브. 세 레포 동형: LangGraph remaining_steps(강제종료)·Claude Code MAX_CONSECUTIVE_AUTOCOMPACT_
//   FAILURES=3(circuit breaker)·AutoGen max_tool_iterations. 모드 무관(loop/react/team-leader/orchestrator
//   공용) — **루프 로컬**이라 orchestrator 의 전체 문맥 인지(substrate 저장소 read-through)와 직교(대표 원칙).
//
// ★ 제1원칙 3박자(대표 지시 2026-07-19) — breaker 는 순수 상태머신이되 3박자를 caller 가 완성하도록 설계:
//   ①관측 — record()가 전이(트립/회복)를 반환해 caller 가 방출. ②자기인지 — consecutiveFailures·threshold·
//   lastReason 노출로 "왜 열렸나"를 안다. ③셀프힐 — open 은 단순 종료가 아니라 **힐 신호원**(caller 가 관측을
//   후속 힐 입력으로). breaker 자체가 폭주를 끊는 것 = 자기수복. LangGraph coordinatorStep 처럼 판정은 순수·
//   방출(I/O)은 caller.

/** breaker 스냅샷 — 관측/자기인지용(직렬화 가능). */
export interface CircuitBreakerState {
  open: boolean;                 // consecutiveFailures >= threshold — 회로 개방(중단)
  consecutiveFailures: number;   // 연속 실패 누적(성공 시 0 리셋)
  threshold: number;
  lastReason?: string;           // 마지막 실패 사유(자기인지)
}

/** record() 결과 — caller 가 관측/힐 분기(전이 시점 포착). */
export interface CircuitBreakerRecord {
  state: CircuitBreakerState;
  /** 이 record 로 처음 open 됐나(트립 순간·관측/힐 1회 방출용). */
  tripped: boolean;
  /** 이 record 로 open→closed 회복됐나. */
  recovered: boolean;
}

export interface CircuitBreaker {
  /** 결과 기록 → 전이 포착 스냅샷. failure 는 연속 누적, success 는 리셋. reason=자기인지 사유. */
  record(outcome: 'success' | 'failure', reason?: string): CircuitBreakerRecord;
  /** 현재 스냅샷(부수효과 없음). */
  readonly state: CircuitBreakerState;
  /** 강제 리셋(회복·새 국면). */
  reset(): void;
}

/** ★ 조각1 — circuit breaker 생성(순수·루프 로컬). threshold 연속 실패 시 open. Claude Code=3 동형(기본 3). */
export function createCircuitBreaker(opts: { threshold?: number } = {}): CircuitBreaker {
  const threshold = Math.max(1, opts.threshold ?? 3);
  let consecutive = 0;
  let lastReason: string | undefined;

  const snapshot = (): CircuitBreakerState => ({
    open: consecutive >= threshold,
    consecutiveFailures: consecutive,
    threshold,
    ...(lastReason ? { lastReason } : {}),
  });

  return {
    record(outcome, reason): CircuitBreakerRecord {
      const wasOpen = consecutive >= threshold;
      if (outcome === 'failure') {
        consecutive += 1;
        if (reason) lastReason = reason;
      } else {
        consecutive = 0;
        lastReason = undefined;
      }
      const nowOpen = consecutive >= threshold;
      return { state: snapshot(), tripped: !wasOpen && nowOpen, recovered: wasOpen && !nowOpen };
    },
    get state() { return snapshot(); },
    reset() { consecutive = 0; lastReason = undefined; },
  };
}
