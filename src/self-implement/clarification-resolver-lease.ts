import {
  getAskUserQuestionResolver,
  setAskUserQuestionResolver,
  type AskUserQuestionResolver,
} from '../ask-user-question/tool.js';

let managedResolver: AskUserQuestionResolver | null = null;
let previousResolver: AskUserQuestionResolver | null = null;
let leaseCount = 0;

export interface ClarificationResolverLease {
  /** ⭐ 「우리가 실제로 설치·소유하고 있나」. config 조건이 아니라 «사실»이다 —
   *  관측에 표면을 적을 때 이 값을 쓴다(무인 리뷰 R4: 조건으로 적으면 또 거짓이 된다). */
  readonly installed: boolean;
  release(): void;
}

/**
 * Shares an opt-in clarification resolver across concurrent self-implement
 * runs. Only the final lease restores the resolver that preceded installation.
 */
export function acquireClarificationResolverLease(
  enabled: boolean,
  createResolver: () => AskUserQuestionResolver,
): ClarificationResolverLease {
  if (!enabled) return { installed: false, release() {} };

  const currentResolver = getAskUserQuestionResolver();
  // ⛔ 관리 중인데 «지금 걸린 것이 우리 것이 아니면» 바깥이 리졸버를 바꾼 것이다.
  //    그때 새로 설치하면 managedResolver·leaseCount 를 덮어써서
  //    ⓐ 살아 있던 lease 의 release 가 «새» 리졸버를 조기 제거하고
  //    ⓑ leaseCount 가 음수가 된다. ⇒ 관리 상태를 건드리지 않고 물러난다.
  if (managedResolver !== null) {
    if (currentResolver !== managedResolver) return { installed: false, release() {} };
    leaseCount += 1;
    return managedLease();
  }
  if (currentResolver !== null) return { installed: false, release() {} };

  previousResolver = currentResolver;
  managedResolver = createResolver();
  leaseCount = 1;
  setAskUserQuestionResolver(managedResolver);
  return managedLease();
}

function managedLease(): ClarificationResolverLease {
  let released = false;
  return {
    installed: true,
    release() {
      if (released) return;
      released = true;
      leaseCount -= 1;
      if (leaseCount !== 0 || managedResolver === null) return;

      const resolverToRestore = previousResolver;
      const resolverToRelease = managedResolver;
      managedResolver = null;
      previousResolver = null;
      if (getAskUserQuestionResolver() === resolverToRelease) {
        setAskUserQuestionResolver(resolverToRestore);
      }
    },
  };
}

/** ⭐ 「설치할까」 판정 — 순수 함수. 무거운 오케스트레이터를 통과하지 않고도 계약을 잰다.
 *  ⛔ 그리고 «건너뛴 이유»를 값으로 돌려준다 — 침묵하는 스킵이 오늘의 사고였다(R-GIT11). */
type ClarificationInstallDecision =
  | { readonly install: true; readonly surface: 'terminal'; readonly delivery: 'terminal' }
  | { readonly install: false; readonly skipReason: 'disabled' | 'timeout-not-configured' | 'unattended-proceeds-unanswered' };

export function decideClarificationResolverInstall(
  cfg: { enabled: boolean; timeoutMs?: number },
  stdinIsInteractive: boolean,
): ClarificationInstallDecision {
  if (!cfg.enabled) return { install: false, skipReason: 'disabled' };
  // ⛔ 기본값 숫자를 코드가 정하지 않는다 — 값이 없으면 무한 대기가 되므로 설치하지 않는다.
  if (cfg.timeoutMs === undefined) return { install: false, skipReason: 'timeout-not-configured' };
  return stdinIsInteractive
    ? { install: true, surface: 'terminal', delivery: 'terminal' }
    : { install: false, skipReason: 'unattended-proceeds-unanswered' };
}
