/**
 * ⭐ 레시피 계약 — ***노드 이름이 「계약」이고 레시피가 「코드」다.***
 *
 * ⛔⭐⭐ 이 파일의 요점은 하나다: ***레시피가 돌려주는 `outcome` 은 «선언의 간선 이름»이어야 한다.***
 *   선언은 `{ from: compose, on: outcome, map: { ok: overlay, app-silent: unobserved, error: blocked } }`
 *   라고 적혀 있다. 레시피가 `success` 를 돌려주면 그 걸음은 «no-edge» 로 죽는다.
 *   🩸 2026-09-22 실측: 걷는 자에 «기본 ok» 를 뒀다가 열다섯 시나리오가 전부 죽었다
 *      (`structure` 는 `ok` 를 모른다 — `found|thin|unmeasurable` 뿐이다).
 *   ⇒ 그래서 «어휘»를 타입으로 좁히지 않고 ***실행 시 선언과 대조***한다(타입은 선언을 못 읽는다).
 */

export interface RecipeCtx {
  /** ⛔ 모든 쓰기는 여기 «안»에서만 한다 — 사람 트리를 건드리지 않는다. */
  readonly workdir: string;
  /** 노드 계약의 `inputs` 가 여기서 읽힌다. 없으면 레시피가 「못 쟀다」로 답해야 한다. */
  readonly state: Readonly<Record<string, unknown>>;
  /** ⛔ 관측 — 조용히 돌지 않는다. */
  readonly log: (event: string, data?: Record<string, unknown>) => void;
}

export interface RecipeResult {
  /** ⛔ 선언의 간선 이름이어야 한다. 아니면 그 걸음이 no-edge 로 죽는다. */
  readonly outcome: string;
  /** 노드 계약의 `outputs` 를 채운다. ⛔ 계약에 없는 키를 내면 그것은 «선언과 다른 계약»이다. */
  readonly produced?: Readonly<Record<string, unknown>>;
  /** 사람이 읽을 한 줄. 실패·「못 쟀다」면 ***왜***를 반드시 적는다. */
  readonly note?: string;
}

export type Recipe = (ctx: RecipeCtx) => Promise<RecipeResult>;

/** ⛔ 「못 쟀다」와 「실패」를 같은 값으로 접지 않는다 — 이 파이프라인의 종단이 넷인 이유다. */
export const UNOBSERVED = 'unmeasurable';
