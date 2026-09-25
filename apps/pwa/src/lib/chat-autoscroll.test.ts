// ⛔ 대표 2026-08-21: *"PWA chat 에서 스크롤이 답답하고 하단 작업이 가려진다"*
//   📏 그때 실측한 기하: 스크롤러 clientH 1005 · scrollH 12777 · bottomGap 8 · paddingBottom «0px»
//     ⊕ 컴포저 83px. 이 시험은 그 수를 그대로 쓴다.

import { describe, expect, test } from 'bun:test';
import {
  NEAR_BOTTOM_SLACK_PX, SCROLL_VIEWPORT_SELECTOR, SHOW_JUMP_BUTTON_PX,
  createStickState, distanceFromBottom, findScrollViewport, onUserScroll,
  shouldFollowOnGrowth, shouldShowJumpToBottom,
  followBehavior, isNearBottom, shouldFollow,
  USER_SCROLL_INTENT_EVENTS, isScrollIntentKey,
} from './chat-autoscroll';

/** 사고 당시의 «실제» 기하. */
const LIVE = { scrollTop: 11765, scrollHeight: 12777, clientHeight: 1005 };

describe('바닥에 붙어 있나', () => {
  test('실측 기하는 «바닥»으로 친다 — bottomGap 8px 은 사람이 올린 게 아니다', () => {
    expect(distanceFromBottom(LIVE)).toBe(7);
    expect(isNearBottom(LIVE)).toBe(true);
  });

  test('여유가 0 이 아니다 — 0 이면 실측 8px 잔차에서 «안 따라간다»', () => {
    expect(NEAR_BOTTOM_SLACK_PX).toBeGreaterThan(8);
    expect(isNearBottom(LIVE, 0)).toBe(false);
  });

  test('사람이 한참 위로 올렸으면 바닥이 아니다', () => {
    expect(isNearBottom({ ...LIVE, scrollTop: 2000 })).toBe(false);
  });

  test('거리는 음수가 되지 않는다 (관성 오버스크롤)', () => {
    expect(distanceFromBottom({ scrollTop: 99999, scrollHeight: 12777, clientHeight: 1005 })).toBe(0);
  });
});

describe('따라갈까', () => {
  test('바닥 근처면 따라간다', () => {
    expect(shouldFollow({ geometry: LIVE, userJustSent: false })).toBe(true);
  });

  test('🚨 위로 올려 «읽는 중»이면 끌어내리지 않는다 (옛 결함)', () => {
    expect(shouldFollow({ geometry: { ...LIVE, scrollTop: 2000 }, userJustSent: false })).toBe(false);
  });

  test('⭐ 사람이 «방금 보냈으면» 위치와 무관하게 따라간다 — 의도가 명확하다', () => {
    expect(shouldFollow({ geometry: { ...LIVE, scrollTop: 0 }, userJustSent: true })).toBe(true);
  });
});

describe('어떻게 붙일까', () => {
  test('자라는 중엔 즉시 — smooth 는 «따라잡지 못해» 답답해진다', () => {
    expect(followBehavior(true)).toBe('auto');
  });

  test('턴이 끝나 한 번 붙일 땐 부드럽게', () => {
    expect(followBehavior(false)).toBe('smooth');
  });
});

/** ⛔⭐⭐⭐ 선택자가 «컴포넌트가 실제로 다는 이름»과 맞는가.
 *
 *  📏 2026-08-21 실물: `ChatHistory` 는 `[data-radix-scroll-area-viewport]` 를 찾고 있었고
 *    그 속성은 DOM 에 «없었다». 위치 복원·저장·자동 따라가기가 ***한 번도 붙은 적이 없다.***
 *  ⚠️ 이런 결함은 «두 파일이 문자열로만 이어져» 있어 각 파일의 시험은 원리상 못 잡는다.
 *    ⇒ 그래서 여기서 «컴포넌트 소스»를 직접 읽어 대조한다. */
describe('스크롤 뷰포트를 «실제로» 찾나', () => {
  test('선택자가 ScrollArea 가 다는 data-slot 과 맞는다', async () => {
    const src = await Bun.file(
      new URL('../components/ui/scroll-area.tsx', import.meta.url).pathname,
    ).text();
    expect(src).toContain('data-slot="scroll-area-viewport"');
    expect(SCROLL_VIEWPORT_SELECTOR).toContain('[data-slot="scroll-area-viewport"]');
  });

  test('🚨 옛 선택자는 그 컴포넌트에 «없다» — 그래서 죽어 있었다', async () => {
    const src = await Bun.file(
      new URL('../components/ui/scroll-area.tsx', import.meta.url).pathname,
    ).text();
    expect(src).not.toContain('data-radix-scroll-area-viewport');
  });

  test('폴백을 남겨 둔다 — 라이브러리가 옛 이름으로 돌아가도 죽지 않게', () => {
    // ⛔ jsdom 이 «없는» 저장소라 실제 DOM 조회는 시험할 수 없다(의도된 제약).
    //   ⇒ 여기서는 «선택자 문자열»이 두 이름을 모두 담는지만 못 박는다.
    expect(SCROLL_VIEWPORT_SELECTOR.split(',')).toHaveLength(2);
    expect(SCROLL_VIEWPORT_SELECTOR).toContain('data-radix-scroll-area-viewport');
  });

});

/** ⛔ 대표 2026-08-21(2차): *"아직 스크롤이 답답한데"*
 *  📏 그때 실측: 여백 96px 은 붙었고 선택자도 살아 있었는데 `bottomGap` 이 224·289 였다.
 *  ⇒ 한 번 떨어지면 «다시 내려올 수단»이 없다는 것이 남은 답답함이었다. */
describe('떨어졌을 때 「맨 아래로」', () => {
  test('바닥 근처에선 버튼이 «안» 뜬다', () => {
    expect(shouldShowJumpToBottom({ scrollTop: 11765, scrollHeight: 12777, clientHeight: 1005 })).toBe(false);
  });

  test('실측으로 「답답하다」던 거리(289px)에선 뜬다', () => {
    expect(shouldShowJumpToBottom({ scrollTop: 11476, scrollHeight: 12770, clientHeight: 1005 })).toBe(true);
  });

  test('⛔ 버튼 임계가 따라가기 여유보다 «넉넉히» 크다 — 같으면 경계에서 깜빡인다', () => {
    expect(SHOW_JUMP_BUTTON_PX).toBeGreaterThan(NEAR_BOTTOM_SLACK_PX * 2);
  });

  test('따라가지 «않는» 구간이라고 다 버튼이 뜨진 않는다 — 조금 떨어진 건 조용히 둔다', () => {
    const g = { scrollTop: 11600, scrollHeight: 12777, clientHeight: 1005 }; // 172px
    expect(shouldFollow({ geometry: g, userJustSent: false })).toBe(false);
    expect(shouldShowJumpToBottom(g)).toBe(false);
  });
});

/** ⛔⭐ 대표 이 «세 번» 지적한 것: 여백도 붙고 버튼도 뜨는데 ***자동으로 안 내려간다.***
 *  🔑 기전: ResizeObserver 는 «자란 뒤»에 부른다 ⇒ 그때 거리를 재면 늘어난 높이만큼 이미 멀다.
 *    ⇒ 바닥에 있던 사람도 여유를 넘겨 「안 따라감」으로 판정됐다. */
describe('붙어 있음은 «성장»이 아니라 «사람»이 정한다', () => {
  const AT_BOTTOM = { scrollTop: 11765, scrollHeight: 12777, clientHeight: 1005 };
  const GREW_500 = { scrollTop: 11765, scrollHeight: 13277, clientHeight: 1005 }; // 500px 자람

  test('🚨 옛 방식은 «자란 것»만으로 따라가기를 멈춘다 (버그 재현)', () => {
    expect(isNearBottom(AT_BOTTOM)).toBe(true);
    expect(isNearBottom(GREW_500)).toBe(false);   // ← 사람은 그대로인데 「멀어졌다」
  });

  test('✅ 새 방식은 성장에도 «붙어 있음»을 유지한다', () => {
    const st = createStickState();                       // 바닥에서 시작
    expect(shouldFollowOnGrowth(st, false)).toBe(true);  // 500px 자라도 따라간다
  });

  test('사람이 위로 올리면 «그때» 떨어진다', () => {
    let st = createStickState();
    st = onUserScroll(st, { ...AT_BOTTOM, scrollTop: 2000 });
    expect(st.stuck).toBe(false);
    expect(shouldFollowOnGrowth(st, false)).toBe(false);
  });

  test('사람이 다시 바닥으로 내리면 «다시» 붙는다', () => {
    let st = onUserScroll(createStickState(), { ...AT_BOTTOM, scrollTop: 2000 });
    st = onUserScroll(st, AT_BOTTOM);
    expect(st.stuck).toBe(true);
  });

  test('⭐ 위로 올려 읽는 중이어도 «내가 보내면» 따라간다', () => {
    const st = onUserScroll(createStickState(), { ...AT_BOTTOM, scrollTop: 2000 });
    expect(shouldFollowOnGrowth(st, true)).toBe(true);
  });

  test('⛔ 성장은 상태를 «바꾸지 않는다» — 이것이 이 수정의 본체다', () => {
    const st = createStickState();
    const before = st.stuck;
    shouldFollowOnGrowth(st, false);
    expect(st.stuck).toBe(before);
  });
});

/** ⛔⭐⭐⭐ 「사람의 스크롤」과 「프로그램 스크롤」을 가르는 계약 — 17차 `[F]`.
 *
 *  📏 2026-08-22(대표 *"스크롤링 하단으로 내리기가 작동이 잘 안 된다"*):
 *  초판은 `scroll` 이벤트에서 `onUserScroll` 을 불렀다. ⇒ ***프로그램 스크롤도 `scroll` 을 낸다.***
 *  「맨 아래로」가 `smooth` 로 내려가는 «동안» 중간 위치가 흘러들어 방금 되돌린 `stuck` 이
 *  곧바로 죽었고, 마운트의 `follow(false)` 도 `smooth` 라 자동 따라가기가 처음부터 죽었다. */
describe('사람의 스크롤 «의도»만 붙어 있음을 바꾼다', () => {
  test('⛔ `scroll` 은 의도 이벤트가 «아니다» — 이 목록의 전부가 그 한 줄이다', () => {
    expect(USER_SCROLL_INTENT_EVENTS).not.toContain('scroll');
    // ⭐ 그리고 실제 입력들은 «들어 있다»(휠 · 터치 · 스크롤바 드래그 · 키보드).
    expect([...USER_SCROLL_INTENT_EVENTS].sort())
      .toEqual(['keydown', 'pointerdown', 'touchmove', 'wheel']);
  });

  test('⭐ 스크롤을 «움직이는» 키만 의도로 본다 — 타이핑은 아니다', () => {
    for (const k of ['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ']) {
      expect(isScrollIntentKey(k)).toBe(true);
    }
    // ⛔ 타이핑이 「붙어 있음」을 바꾸면, 답을 기다리며 다음 질문을 쓰는 사람이 화면을 잃는다.
    for (const k of ['a', 'Z', '1', 'Enter', 'Backspace', 'Shift', 'Escape']) {
      expect(isScrollIntentKey(k)).toBe(false);
    }
  });
});
