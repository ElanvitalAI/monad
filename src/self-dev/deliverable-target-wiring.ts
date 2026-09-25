// 🔌 골 문서의 «켜기 선언» → 오케스트레이트의 `deliverableTargets` 생산자.
//
// ⛔ 이 셀이 있는 이유 — 2026-08-20 전수 실측: `deliverableTargets` 는 타입·소비(orchestrate.ts:1004)가
//   «둘 다 있는데» 그것을 «채우는 자»가 테스트 넷 말고 하나도 없었다. 그래서 힐링 폐루프의 눈이
//   하니스 런 «안»에서는 한 번도 안 떴다. 결손은 「칸이 없다」가 아니라 ***「생산자가 없다」***였다.
//
// ⭐ 계약 둘:
//   ⓐ 조각은 «자기 문서»를 갖지 않는다 — N조각이 «한» ask 문서에서 파생된다.
//      그래서 이 함수는 문서를 «한 번» 읽고 결과를 «인자»로 내려보낸다(실행 맥락 계약과 같은 형태).
//   ⓑ 「어느 조각에 귀속하나」는 «숨은 기본값»이 아니라 호출자가 «고르는 값»이다(`attribution`).
import { parseArtifactLaunchDeclaration } from '../self-implement/goal-author.js';
import type { DeliverableObservationTarget } from '../harness/deliverable-observation.js';
import { debug } from '../debug/log.js';

/** ⛔ 「안 실었다」의 «이름». 층이 다른 어휘와 접지 마라 — 이 층은 「배선했나」만 답한다.
 *  ⛔ **export 하지 않는다** — 반환 타입으로 «구조적으로» 소비되므로 이름을 공개할 필요가 없고,
 *  공개하면 「쓰는 데 없는 표면」이 남는다(리뷰 #10550). 필요해지는 그때 올린다. */
type DeliverableWiringSkipReason =
  | 'no-launch-declaration'
  | 'no-port-declaration'
  | 'no-goal-ids'
  /** ⛔ 「호출자가 고른다」 계약을 «런타임에서도» 지킨다 — 타입을 안 보는 호출자(JS·설정값·NL)가
   *  모르는 값을 주면 묵시적 'all' 로 흐르는 대신 «이름을 대고» 거부한다(리뷰 #10550 should-fix). */
  | 'invalid-attribution';

/** 산출물을 «어느 조각»에 귀속할지. 기본값을 두지 않는다 — 호출자가 고른다. */
export type DeliverableAttribution = 'all' | 'last';

type DeliverableWiringResult =
  | { readonly wired: true; readonly targets: readonly DeliverableObservationTarget[]; readonly port: number }
  | { readonly wired: false; readonly reason: DeliverableWiringSkipReason };

const observe = (event: string, data: Record<string, unknown>): void => {
  try { debug.log('self-dev.deliverable-wiring', event, data); } catch { /* fail-soft */ }
};

/** 선언의 포트로 만드는 관측 URL. ⛔ 선언에 «경로» 칸은 없다 — 루트로 고정한다.
 *  ⛔ **export 하지 않는다** — 프로덕션 소비자가 `buildDeliverableTargets` 하나뿐인데 공개하면
 *  「쓰는 데 없는 표면」이 남는다(리뷰 #10550 must-fix). 필요해지는 «그때» 올린다.
 *  ⛔⭐ `host` 에 기본값을 두지 않는다 — 호출자가 어느 호스트를 관측하는지 «모르는데»
 *  `127.0.0.1` 로 단정하면 그것은 「그럴듯한 값」이다(리뷰 #10550 must-fix). 모르면 못 만든다. */
function deliverableTargetUrl(port: number, host: string): string {
  return `http://${host}:${port}/`;
}

/**
 * 골 문서의 켜기 선언을 읽어 `deliverableTargets` 를 만든다.
 *
 * ⛔ 실패는 «조용하지 않다» — 못 실은 이유가 항상 이름을 갖는다.
 * ⚠️ 이 함수는 앱을 «켜지 않는다». 켜는 것은 `verifyDeliverable` 심(launchAndVerifyGoalDeliverable)이다.
 */
// ⛔⭐ 이 셀은 «순수»하지 않다 — 그리고 그것이 «의도»다.
//   제1원칙이 자율 로직에 관측을 «요구»한다(CLAUDE.md). 그래서 유일한 부작용은 `debug.log` 하나이고
//   그것도 try/catch 로 fail-soft 다. 반환값은 입력에만 의존한다(결정적).
//   ⇒ 리뷰 #10550 must-fix ①의 수리는 「로그를 없앤다」가 아니라 ***「내가 쓴 주장을 고친다」***였다.
export function buildDeliverableTargets(
  document: string,
  goalIds: readonly string[],
  attribution: DeliverableAttribution,
  host: string,
): DeliverableWiringResult {
  if (attribution !== 'all' && attribution !== 'last') {
    observe('skipped', { reason: 'invalid-attribution', attribution: String(attribution) });
    return { wired: false, reason: 'invalid-attribution' };
  }
  const ids = goalIds.filter((id) => typeof id === 'string' && id.trim() !== '');
  if (ids.length === 0) {
    observe('skipped', { reason: 'no-goal-ids', goalIdCount: goalIds.length });
    return { wired: false, reason: 'no-goal-ids' };
  }

  const declaration = parseArtifactLaunchDeclaration(document);
  if (declaration === null) {
    observe('skipped', { reason: 'no-launch-declaration', goalIdCount: ids.length });
    return { wired: false, reason: 'no-launch-declaration' };
  }
  if (declaration.port === undefined) {
    observe('skipped', { reason: 'no-port-declaration', goalIdCount: ids.length });
    return { wired: false, reason: 'no-port-declaration' };
  }
  // ⛔⭐ 범위 검사(1~65535)를 «여기 두지 않는다» — 파서가 이미 «전부» 막는다
  //   (goal-author.ts `Port must be an integer from 1 through 65535`).
  //   한 번 넣었다가 뺐다: 넣으면 그 이름이 «영영 안 뜨는» 계약 칸이 되고,
  //   그런 칸은 「검사하고 있다」는 인상만 주면서 실제로는 아무것도 안 판정한다.
  //   ⇒ 범위 계약의 소유자는 파서다. 그 계약이 바뀌면 아래 시험이 «먼저» 빨개진다.
  const port = declaration.port;

  const target = deliverableTargetUrl(port, host);
  const attributed = attribution === 'last' ? ids.slice(-1) : ids;
  const targets = attributed.map((taskId) => ({ taskId, target }));
  observe('wired', { port, attribution, targetCount: targets.length, goalIdCount: ids.length });
  return { wired: true, targets, port };
}
