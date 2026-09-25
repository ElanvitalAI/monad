/** ⭐ self-implement **PR 승인 카드를 어느 표면으로 보낼지**를 정하는 **순수** 결정.
 *
 *  ⛔ 왜 함수로 뺐나(리뷰 must-fix): 대시보드 부팅 안에 인라인이면 **읽기 실패 경로**와
 *  **기본값 계약**을 테스트가 못 잡는다 — 그 둘이 정확히 *"오타 하나가 아이폰 푸시를 다시 켠다"* 를
 *  막는 자리다.
 *
 *  ⚠️ `'terminal'` 은 **터미널 채널 하나**를 뜻하고, *"런을 시작한 표면으로 동적 라우팅"* 이 **아니다**. */
export type PrApprovalDelivery = 'terminal' | 'all';

export function resolvePrApprovalDelivery(
  readConfig: () => { tools?: { selfImplement?: { prApprovalDelivery?: unknown } } },
): PrApprovalDelivery {
  try {
    const v = readConfig().tools?.selfImplement?.prApprovalDelivery;
    // ⛔ 좁은 쪽이 기본이다 — `'all'` 을 **명시**했을 때만 팬아웃한다.
    return v === 'all' ? 'all' : 'terminal';
  } catch {
    // ⛔ 읽기 실패도 좁은 쪽으로 — 설정을 못 읽었다고 폰으로 밀어내지 않는다.
    return 'terminal';
  }
}

/** ⭐ 승인 카드 **요청 자체**를 만든다 — `delivery` 를 포함해서.
 *
 *  ⛔ 왜 이것까지 뺐나(3R 리뷰 must-fix): 결정 함수만 빼 두면 *"대시보드가 그 값을 실제로 싣는가"* 를
 *  테스트가 못 본다. 그 자리를 가짜 객체로 흉내 내면 **자기 자신을 검증하는 Goodhart** 가 된다.
 *  ⇒ **production 이 이 함수를 부르고 테스트도 이 함수를 부른다.** `delivery` 를 여기서 빼면 둘 다 깨진다.
 *
 *  ⚠️ `delivery` 가 `undefined` 면 `requestConfirmation` 은 **wired 채널 전부를 레이스**한다 —
 *  그것이 대표 아이폰에 카드가 뜬 경로다. 이 함수는 **항상 값을 싣는다.** */
export interface PrApprovalRequest {
  prompt: string;
  detail: string;
  yesLabel: string;
  noLabel: string;
  delivery: PrApprovalDelivery;
}

export function buildPrApprovalRequest(args: {
  branch: string;
  implSummary: string;
  gateLog?: string;
  delivery: PrApprovalDelivery;
}): PrApprovalRequest {
  return {
    prompt: `self-implement: draft PR 열까요? (branch ${args.branch})`,
    detail: [
      args.implSummary.slice(0, 1200),
      args.gateLog ? `\n[gate]\n${args.gateLog.slice(0, 600)}` : '',
    ].join(''),
    yesLabel: 'PR 열기',
    noLabel: '취소',
    delivery: args.delivery,
  };
}
