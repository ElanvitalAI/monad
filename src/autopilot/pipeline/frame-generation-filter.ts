// ── 프레임 세대 필터 — replay/rewind/goto 세대 인지 (H6 · 2026-07-20) ─────────
//
// ★ RFC-coordinator-loop-template-lineage-historian(H4 후속). H4 가 프레임에 generation 을 스탬프해
//   관측(g?→gN)을 세웠고, 이제 replay/rewind/goto 가 **세대를 혼합하지 않도록** 대상 세대 프레임만
//   재구성한다. rerun(세대+1) 후 gen0/gen1 프레임이 한 파일에 쌓여도, 리플레이는 최신(또는 지정) 세대만.
//
// 순수 함수(단위테스트). PipelineFrame·ExecutionFrame 공통(둘 다 generation? 보유) — 제네릭.
//
// 하위호환: pre-H4 프레임은 generation undefined → effectiveGeneration=0(원 세대 취급). rerun 을
//   pre-H4 에 한 미션은 gen0/gen1 이 모두 undefined 라 구분 불가(불가피·신규 rerun 은 정상 스탬프).

/** 프레임의 유효 세대 — 미상(pre-H4)은 0(원 세대). */
export function effectiveGeneration(frame: { generation?: number }): number {
  return frame.generation ?? 0;
}

/** 프레임 집합의 최신 세대(없으면 0). */
export function latestGeneration(frames: readonly { generation?: number }[]): number {
  return frames.reduce((mx, f) => Math.max(mx, effectiveGeneration(f)), 0);
}

/** 대상 세대(미지정=최신) 프레임만. replay/rewind/goto 가 세대 혼합을 피하려 이걸로 스코프. */
export function framesForGeneration<T extends { generation?: number }>(frames: readonly T[], gen?: number): T[] {
  const target = gen ?? latestGeneration(frames);
  return frames.filter((f) => effectiveGeneration(f) === target);
}
