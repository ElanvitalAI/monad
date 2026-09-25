// ── 채팅 자동 스크롤 판단 ──
//
// ⛔⭐ **이 파일이 있는 이유**(대표 2026-08-21: *"스크롤이 답답하고 하단 작업이 가려진다"*):
//   초판은 `useEffect(..., [messages.length, pending])` 로만 바닥에 붙였다.
//   ⇒ 메시지 «수»가 늘 때만 따라가므로, ***마지막 메시지가 스트리밍으로 «자라는» 동안엔
//     화면이 그대로 있고 새 줄이 컴포저 뒤로 숨는다.*** 그것이 「가려진다」의 본체다.
//
// ⭐ 판단을 창에서 떼어 두는 이유: 이 웹 화면엔 리액트 시험 도구가 «없다».
//   붙여 두면 「따라갈지 말지」를 영영 시험할 수 없다.

/** 바닥에서 이 픽셀 안에 있으면 「사용자가 바닥을 보고 있다」로 친다.
 *  ⛔ 0 이 아니다 — 관성 스크롤·소수점 높이 때문에 실측에서 `bottomGap` 이
 *  8px 남는 것을 봤다. 0 으로 두면 「바닥에 있는데 안 따라가는」 상태가 생긴다. */
export interface ScrollGeometry {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export const NEAR_BOTTOM_SLACK_PX = 96;

/** 「맨 아래로」 버튼을 띄울 거리.
 *  ⛔ 따라가기 여유(96)보다 «넉넉히» 커야 한다 — 같으면 경계에서 버튼이 깜빡인다.
 *  📏 2026-08-21: 사람이 「답답하다」고 한 상태의 실측 거리가 224·289px 였다. */
export const SHOW_JUMP_BUTTON_PX = 240;

export function shouldShowJumpToBottom(g: ScrollGeometry): boolean {
  return distanceFromBottom(g) > SHOW_JUMP_BUTTON_PX;
}



export function distanceFromBottom(g: ScrollGeometry): number {
  return Math.max(0, g.scrollHeight - g.clientHeight - g.scrollTop);
}

export function isNearBottom(g: ScrollGeometry, slack = NEAR_BOTTOM_SLACK_PX): boolean {
  return distanceFromBottom(g) <= slack;
}

/** 지금 바닥으로 따라갈까.
 *
 *  ⛔ **사용자가 «위로 올려 읽는 중»이면 끌어내리지 않는다.** 초판은 새 메시지마다
 *  무조건 `scrollIntoView` 를 불러, 지난 답을 읽는 사람을 계속 아래로 낚아챘다.
 *  ⭐ 단, 「사람이 방금 보냈다」면 의도가 명확하므로 위치와 무관하게 따라간다. */
export function shouldFollow(input: {
  geometry: ScrollGeometry;
  userJustSent: boolean;
  slack?: number;
}): boolean {
  if (input.userJustSent) return true;
  return isNearBottom(input.geometry, input.slack);
}

/** 어떤 방식으로 붙일까.
 *
 *  ⛔ 스트리밍 중 `smooth` 는 «따라잡지 못한다» — 애니메이션이 끝나기 전에 내용이 또 자라서
 *  화면이 늘 한 박자 뒤에 있고, 그것이 「답답하다」로 느껴진다.
 *  ⇒ 자라는 중에는 즉시(`auto`), 턴이 끝나 한 번 붙일 때만 `smooth`. */
export function followBehavior(streaming: boolean): ScrollBehavior {
  return streaming ? 'auto' : 'smooth';
}

/** 스크롤 뷰포트를 찾는 선택자.
 *
 *  ⛔⭐⭐⭐ **초판은 `[data-radix-scroll-area-viewport]` 를 찾았고 그것은 «없다».**
 *  📏 2026-08-21 실물 확인: `document.querySelector('[data-radix-scroll-area-viewport]')` → `null`,
 *    `[data-slot="scroll-area-viewport"]` → 있음(`components/ui/scroll-area.tsx` 가 그 이름을 단다).
 *  ⇒ 그래서 위치 복원·위치 저장·자동 따라가기가 ***한 번도 붙은 적이 없다.*** 조용히 죽어 있었다.
 *  ⛔ 이런 「선택자가 안 맞는다」는 시험이 원리상 못 잡는다(컴포넌트와 선택자가 다른 파일에 산다)
 *    — 그래서 `chat-autoscroll.test.ts` 가 «둘을 한 자리에서» 문다.
 *
 *  ⭐ 옛 이름을 폴백으로 남긴다 — 라이브러리가 되돌아가도 죽지 않게. */
export const SCROLL_VIEWPORT_SELECTOR =
  '[data-slot="scroll-area-viewport"],[data-radix-scroll-area-viewport]';

export function findScrollViewport(root: ParentNode | null | undefined): HTMLElement | null {
  return root?.querySelector<HTMLElement>(SCROLL_VIEWPORT_SELECTOR) ?? null;
}

/** ⛔⭐⭐⭐ **「지금 바닥인가」가 아니라 「자라기 «전»에 바닥이었나」를 물어야 한다.**
 *
 *  📏 2026-08-21 실물(대표 이 «두 번» 지적): 여백도 붙고 버튼도 뜨는데 ***자동으로 안 내려간다.***
 *  🔑 기전: `ResizeObserver` 는 내용이 «자란 뒤»에 부른다. 그 시점에 거리를 재면
 *    방금 늘어난 높이만큼 이미 «멀어져» 있다 — 500px 짜리 블록이 붙으면 거리가 500 이다.
 *    ⇒ 여유(96)를 넘으므로 `shouldFollow` 가 false 를 내고, ***바닥에 있던 사람도 안 따라간다.***
 *    그리고 한 번 놓치면 계속 멀어지므로 영영 안 붙는다.
 *
 *  ✅ 그래서 「붙어 있음」을 «상태»로 들고, 그 상태는 ***사람이 스크롤할 때만*** 바꾼다.
 *    내용 성장은 그 상태를 «바꾸지 않는다» — 성장은 사람의 의도가 아니기 때문이다. */
export interface StickState {
  /** 사람이 마지막으로 스크롤했을 때 바닥 근처였나. 초기값은 true(대화는 바닥에서 시작한다). */
  stuck: boolean;
}

export function createStickState(): StickState {
  return { stuck: true };
}

/** 사람이 스크롤했다 — 그때의 거리로 「붙어 있음」을 «다시» 정한다.
 *
 *  ⛔⭐⭐⭐ **「사람이」가 이 함수의 전제다 — 그 전제를 부르는 쪽이 지켜야 한다.**
 *  📏 2026-08-22 실측(17차 `[F]` · 대표 *"스크롤링 하단으로 내리기가 작동이 잘 안 된다"*):
 *  초판은 이것을 **`scroll` 이벤트**에서 불렀다. ⇒ ***프로그램 스크롤도 `scroll` 을 낸다.***
 *  그래서 「맨 아래로」가 `behavior: 'smooth'` 로 내려가는 «동안» 이 함수가 중간 위치들로
 *  계속 불렸고, 중간은 바닥이 아니므로 ***방금 `true` 로 되돌린 `stuck` 이 곧바로 `false` 가 됐다.***
 *  ⊕ 마운트 시 `follow(false)` 도 `'smooth'` 라 ***자동 따라가기가 처음부터 죽었다.***
 *  ⇒ 🔑 그래서 호출 시점을 ***「입력 이벤트」***로 옮겼다(`USER_SCROLL_INTENT_EVENTS`) —
 *    ***프로그램 스크롤은 입력을 내지 않으므로 원리상 오판될 수 없다.*** */
export function onUserScroll(state: StickState, g: ScrollGeometry, slack = NEAR_BOTTOM_SLACK_PX): StickState {
  return { stuck: isNearBottom(g, slack) };
}

/** ⛔⭐⭐ 「사람이 스크롤하려는 의도」를 내는 이벤트들. **`scroll` 은 여기 «없다»** — 그것이 이 목록의 전부다
 *  (프로그램 스크롤과 구분이 안 되기 때문). `pointerdown` 은 스크롤바 드래그를 덮는다. */
export const USER_SCROLL_INTENT_EVENTS = ['wheel', 'touchmove', 'pointerdown', 'keydown'] as const;

/** 스크롤을 «움직이는» 키인가. ⛔ 모든 키가 아니다 — 타이핑이 「붙어 있음」을 바꾸면 안 된다. */
export function isScrollIntentKey(key: string): boolean {
  return key === 'PageUp' || key === 'PageDown' || key === 'Home' || key === 'End'
    || key === 'ArrowUp' || key === 'ArrowDown' || key === ' ' || key === 'Spacebar';
}

/** 내용이 자랐다 — ⛔ 상태를 «바꾸지 않고» 그대로 쓴다. */
export function shouldFollowOnGrowth(state: StickState, userJustSent: boolean): boolean {
  return userJustSent || state.stuck;
}
