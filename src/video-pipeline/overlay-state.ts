import type { Tier } from './capabilities.js';

/** 계획이 «고른» 것 한 칸 — 오버레이 조건이 읽을 사실의 원천. */
export interface PickedForOverlay {
  readonly cap: string;
  readonly tier: Tier | null;
}

/**
 * ⛔⭐⭐ ***오버레이 조건은 「비교 하나」다 — 사실은 «도구»가 계산한다.***
 *
 * 🩸 실측 2026-09-23: 영상 오버레이 넷이 `selected('app-control')`·`any_selected_tier('metered')`
 *   같은 ***함수 꼴***을 쓰고 있었는데, 엔진의 DSL(`graph-overlay-condition.ts`)은 비교 연산자만 안다.
 *   ⇒ 판정이 전부 `unparseable` 이었고 ***얹힌 오버레이가 «0개»*** 였다. 그리고 조용했다.
 *
 * 🔑 그래서 엔진을 넓히지 않고 «값»을 준다 — 엔진 자신의 규율(*"판정을 «값»으로 낸다"*)과 같은 방향이다.
 *
 * ⛔⭐ ***못 재는 키는 «넣지 않는다».*** 0 으로 채우면 「조건이 거짓」과 「못 쟀다」가 한 칸이 된다 —
 *   엔진은 그 둘을 `does-not-apply` 와 `key-absent` 로 «이미 갈라» 답하므로, 여기서 접으면 그 값을 버린다.
 *   예: `found_footage` 는 「소재 디렉토리가 있나」를 알아야 하는데 `plan` 은 그것을 모른다 ⇒ 안 넣는다.
 */
/**
 * ⛔⭐⭐ ***「내가 «잰» 사실」과 「사람이 «말한» 사실」은 다른 값이다.***
 *
 * 🔑 §4(「슬래시 다음 한 마디」)의 접합점이 여기다 — 오버레이 조건이 읽는 사실 중에는
 *   ***`plan` 이 원리상 못 재는 것***이 있다(예: `found_footage` = 소재 디렉토리가 있나).
 *   그 칸을 채울 수 있는 것은 «사람의 한 마디»뿐이다.
 *
 * ⛔ 그래서 받되, ***섞지 않는다.*** 한 칸으로 접으면 산출을 읽는 사람이
 *   「도구가 쟀다」와 「내가 그렇게 말했다」를 구분할 수 없고, ***틀린 말을 도구의 실측으로 읽는다.***
 * ⛔ 그리고 ***잰 키는 말로 덮지 못한다.*** 덮게 두면 도구가 사람 말을 자기 실측인 양 내게 된다 —
 *   거부하고 «거부했다»를 값으로 낸다(조용히 무시하면 「반영됐다」로 읽힌다).
 */
export interface OverlayStateResult {
  /** 조건 엔진에 넘길 최종 상태(잰 것 ⊕ 받은 것). */
  readonly state: Record<string, number>;
  /** 도구가 «잰» 키. */
  readonly measured: readonly string[];
  /** 사람이 «말해 준» 키 — 잰 것이 아니다. */
  readonly told: readonly string[];
  /** 말했지만 «안 받은» 것 ⊕ 이유. ⛔ 조용히 버리지 않는다. */
  readonly refused: readonly { readonly key: string; readonly why: string }[];
}

export function overlayState(
  picked: readonly PickedForOverlay[],
  /** 사람이 값으로 대 주는 사실. ⛔ 잰 키와 겹치면 «거부»된다. */
  told: Readonly<Record<string, number>> = {},
): OverlayStateResult {
  const live = picked.filter((p) => p.tier !== null);
  const state: Record<string, number> = {
    selected_app_control: live.filter((p) => p.cap === 'app-control').length,
    selected_metered_count: live.filter((p) => p.tier === 'metered').length,
    // ⛔ found_footage 는 여기서 «의도적으로 없다» — plan 이 못 재는 사실이다(위 주석).
    //   그 키는 오직 `told` 로만 들어온다.
  };
  const measured = Object.keys(state);
  const accepted: string[] = [];
  const refused: { key: string; why: string }[] = [];
  for (const [k, v] of Object.entries(told)) {
    if (measured.includes(k)) { refused.push({ key: k, why: '도구가 «재는» 키다 — 말로 덮지 않는다' }); continue; }
    if (!Number.isFinite(v)) { refused.push({ key: k, why: '수가 아니다 — 조건 엔진은 비교만 안다' }); continue; }
    state[k] = v;
    accepted.push(k);
  }
  return { state, measured, told: accepted, refused };
}
