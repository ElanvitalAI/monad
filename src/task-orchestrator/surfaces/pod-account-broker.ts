// Pod 계정 브로커 — 병렬 Pod 런이 codex 계정 «하나»에 몰리지 않게, Job 마다 잔량 많은 계정을 돌려 가며 준다
// (로드맵 09-26 #7 · docker·k8s 로드맵 C3). 잔량 신호는 회전 판정과 «같은 심»(`inspectCodexRotation`)에서 읽는다.
//
// ⛔ 한도에 닿은 계정(`reached === true`)과 사용률이 문턱 이상인 계정은 뺀다. 신호가 없는 계정(`undefined`)은
//    «모른다»라서 뒤로 보내되 빼지 않는다(못 읽었다고 갈 곳을 없애지 않는다 — 회전 규칙과 같다).
// ⛔ `--pod-account` 를 명시하면 브로커를 쓰지 않는다 — 사람의 의도가 이긴다.

import type { RotationCandidate } from '../../oauth/codex-account-rotation.js';

export const POD_ACCOUNT_EXCLUDE_AT_PERCENT = 95;

export interface PodAccountPlan { usable: string[]; excluded: Array<{ name: string; why: string }> }

export function planPodAccounts(candidates: readonly RotationCandidate[], excludeAt = POD_ACCOUNT_EXCLUDE_AT_PERCENT): PodAccountPlan {
  const excluded: PodAccountPlan['excluded'] = [];
  const known: RotationCandidate[] = [];
  const unknown: RotationCandidate[] = [];
  for (const c of candidates) {
    if (c.reached === true) { excluded.push({ name: c.name, why: 'quota reached' }); continue; }
    if (c.usedPercent !== undefined && c.usedPercent >= excludeAt) { excluded.push({ name: c.name, why: `used ${c.usedPercent}% ≥ ${excludeAt}%` }); continue; }
    (c.usedPercent === undefined ? unknown : known).push(c);
  }
  known.sort((a, b) => (a.usedPercent! - b.usedPercent!) || a.name.localeCompare(b.name));
  unknown.sort((a, b) => a.name.localeCompare(b.name));
  return { usable: [...known, ...unknown].map((c) => c.name), excluded };
}

/** Job 마다 다음 계정 — 잔량 순으로 돌려 가며. 쓸 계정이 없으면 만들 때 이유를 대고 던진다. */
export function makePodAccountBroker(plan: PodAccountPlan): () => string {
  if (plan.usable.length === 0) {
    throw new Error(`pod: 쓸 codex 계정이 없다 — ${plan.excluded.map((e) => `${e.name}(${e.why})`).join(' · ') || '계정 0개'} · 계정을 명시하려면 --pod-account <이름>`);
  }
  let i = 0;
  return () => plan.usable[i++ % plan.usable.length]!;
}
