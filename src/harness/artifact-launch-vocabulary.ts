// 🔤 산출물 «켜기» 판정의 «공유 어휘» — ⛔ 어휘를 «접는» 파일이 아니다.
//
// ⛔⭐⭐ **왜 「하나로 접기」가 아닌가** (2026-08-20 전수 측정):
//   켜기 축의 사유 이름은 네 층에 걸쳐 **고유 22개**인데 «겹치는 것은 다섯»뿐이다.
//   ⇒ 🔑 ***네 어휘는 「층마다 다른 질문」에 답한다*** — 접으면 층이 뭉개진다.
//     저작기는 「이 골이 선언을 갖췄나」를, 런처는 「이 프로세스를 띄울 수 있나」를,
//     배선은 「관측 타깃을 만들 수 있나」를, CLI 는 「사람에게 무엇을 말하나」를 답한다.
//
// 🔑 **진짜 위험은 다른 것이다** — 겹치는 그 다섯이 «네 곳에 따로» 적혀 있어서
//   한 곳에서 이름이 바뀌면 «나머지 셋이 조용히 갈린다». 그러면 같은 사건이 두 이름을 갖고,
//   세는 자가 둘로 갈린다(이 저장소가 반복해 밟은 형태).
//
// ⇒ ⭐ 그래서 이 파일은 ***「접는 자」가 아니라 「갈리면 빨개지게 하는 자」***다.
//   각 층은 자기 유니온을 «그대로» 쓰고, 시험이 이 목록과 대조한다.
//   ⛔ 새 이름을 여기 «먼저» 더하지 마라 — 층에서 이름이 «겹치게 된 뒤»에 여기로 온다.

/** 두 층 이상이 «같은 뜻»으로 쓰는 사유 이름. ⛔ 층 «전용» 이름은 여기 없다(있으면 안 된다). */
export const SHARED_ARTIFACT_LAUNCH_REASONS = [
  'ambiguous-command-source',
  'invalid-launch-declaration',
  'no-command-source',
  'no-launch-declaration',
  'no-port-declaration',
] as const;

export type SharedArtifactLaunchReason = typeof SHARED_ARTIFACT_LAUNCH_REASONS[number];

/** 어떤 층의 사유 유니온이 공유 어휘와 «어긋난 자리»를 낸다.
 *
 *  ⛔ 「같다/다르다」로 답하지 않는다 — ***무엇이 어긋났는지***를 낸다.
 *  「이 층이 공유 이름을 쓰면서 철자가 갈렸다」와 「이 층은 그 이름을 원래 안 쓴다」는 다른 값이라,
 *  판정은 시험이 하고 이 함수는 «재료»만 준다. */
export function sharedReasonDrift(layerReasons: readonly string[]): {
  /** 공유 어휘에 있는데 이 층이 «안 쓰는» 이름. ⚠️ 정상일 수 있다(그 층의 질문이 아니면). */
  readonly absent: readonly SharedArtifactLaunchReason[];
  /** 이 층이 쓰는데 공유 어휘에 «없는» 이름. ⚠️ 대부분 정상이다(층 전용 이름). */
  readonly layerOnly: readonly string[];
} {
  const shared = new Set<string>(SHARED_ARTIFACT_LAUNCH_REASONS);
  const layer = new Set(layerReasons);
  return {
    absent: SHARED_ARTIFACT_LAUNCH_REASONS.filter((name) => !layer.has(name)),
    layerOnly: [...layer].filter((name) => !shared.has(name)).sort(),
  };
}
