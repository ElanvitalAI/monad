// ── Lineage substrate (Historian) — 타입 · 추상 seam (H0 · 2026-07-20) ────────
//
// ★ RFC-coordinator-loop-template-lineage-historian §3c. 미션 히스토리(이력) 부기를
//   조율자에서 떼어 **결정론 substrate** 로 1급화한다. 조율자는 intent 만 선언하고,
//   Historian 이 "이력을 어떻게 보관·정리·관측하나(how)"를 전부 소유한다.
//
// 경계(조율자 무관 core): 판단(judgment)=조율자·LLM / 부기(bookkeeping)=결정론 substrate.
//   memory-lifecycle 철학("삭제 아닌 요약·이관·보관")·[[feedback_mission_fabric_llm_logic_balance]] 정합.
//
// 추상성: Historian 은 "프레임이 무엇인가"를 모른다. 각 루프(빌드/투자/비즈)가 자기
//   LineageSource 를 등록(mountSubstrate)하고, Historian 은 루프-불문 프리미티브만 제공
//   (append·partition·coldArchive·unifiedObserve·gc). 5-way 스토어 지도 = RFC §2a.

/** 재실행/종결 intent — 조율자가 선언, Historian 이 정책(resolveLineagePolicy)으로 변환. RFC §3d 매트릭스. */
export type ReexecIntent =
  | 'revise' // 골 유지·notes/방향 정정 — 데이터 유효
  | 'revise-goal' // 골 문자열 변경 — goalHash miss
  | 'redecompose' // critique 재분해 — 분해 로직만 틀림·조사 데이터는 유효(캐시 존재 이유)
  | 'redesign' // 전제/형태 전환 — 외부 전제 바뀜·코드는 그대로
  | 'rerun' // 구현 실패 후 처음부터 — 새 코드 재조사
  | 'rebuild-phase' // 특정 페이즈 재구현
  | 'cancel-purge' // 완전 종결(행 삭제) — 냉동보관 후 제거
  | 'cancel-defer'; // 보류(rejected·행 유지)

/** 히스토리 스토어 6-way (RFC §2a + observation L1). */
export type LineageStoreKind =
  | 'generation-archive' // ① tasks.db 미션 행 autopilot.rerunHistory(CAP 10)
  | 'working-memory' // ② conatus/missions/<id>/working-memory.jsonl + config-dir 아카이브
  | 'build-frames' // ③ pipeline_frames/<id>.jsonl + LLM sidecar
  | 'exec-frames' // ④ <id>.exec.jsonl (put_writes/pending-write)
  | 'cache' // ⑤ grounding-cache.json (grounding/research)
  | 'observation'; // ⑥ logs.db 의 mission.*/intent.* debug.log 관측 포인트(L1·2026-07-20 대표 지시
  //    "debug.log 만 심은 포인트도 Historian 이 다 알도록"). 69개 카테고리가 통합 타임라인에 안 뜨던
  //    사각 수복 — pull-only 어댑터(emit 사이트 무변경).

export const LINEAGE_STORE_KINDS: readonly LineageStoreKind[] = [
  'generation-archive',
  'working-memory',
  'build-frames',
  'exec-frames',
  'cache',
  'observation',
];

/** 스토어에 적용할 생애주기 동작. */
export type LineageAction =
  | 'keep' // 유지(무동작)
  | 'cold-archive' // 냉동보관 이관(삭제 아님 — self-recall 도달 유지)
  | 'gc'; // 삭제(고아 verbose 저널 한정)

/** 캐시 세부 — research(외부조사)·grounding(내부소스)를 분리 판정(무효화 신호가 다름·RFC §3d).
 *  'reuse' = intent 가 재사용 허용(실 freshness=TTL/SHA 는 여전히 게이트) · 'invalidate' = 강제 무효(재조사). */
export interface CachePolicy {
  research: 'reuse' | 'invalidate';
  grounding: 'reuse' | 'invalidate';
}

/** intent → 정책. 조율자·cancel·rerun·revise 가 이 순수 함수 하나를 consult(단일 관문). */
export interface LineagePolicy {
  /** 스토어별 생애주기 동작(cancel 계열만 keep 이외). */
  stores: Record<LineageStoreKind, LineageAction>;
  /** 캐시 재사용/무효(재실행 계열). */
  cache: CachePolicy;
}

/** 통합 타임라인의 관측 단위(추상) — 각 LineageSource 가 자기 이력을 이 형태로 방출. H1 이 세대축 병합. */
export interface LineageEntry {
  store: LineageStoreKind;
  /** ISO 타임스탬프(정렬 키). 없으면 seq 로 폴백. */
  at?: string;
  /** 세대(rerun/revise generation). 미상=undefined(H4 이전 ③④⑤). */
  generation?: number;
  /** 사람용 한 줄 요약(관측 렌더). */
  summary: string;
  /** 정렬 보조(같은 at 내). */
  seq?: number;
}

/** ★ 추상 seam(마운트 계약) — 각 루프가 자기 히스토리 스토어를 이 인터페이스로 등록.
 *  Historian 은 store 종류만 알 뿐 "프레임이 무엇인지" 모른다(루프-불문). fail-soft: 각 메서드 예외는
 *  Historian 이 흡수(부기 실패가 미션을 절대 막지 않음). */
export interface LineageSource {
  kind: LineageStoreKind;
  /** 사람용 라벨(관측). */
  label: string;
  /** 통합 타임라인용 이력 방출(read-only·결정론). */
  readTimeline: (missionId: string) => LineageEntry[];
  /** 냉동보관 — cold ledger 로 이관(구현 시 배선·H2/H3). 미구현이면 Historian 이 skip. */
  coldArchive?: (missionId: string) => { archived: number };
  /** GC — 고아 파일 삭제(H3). 미구현이면 skip. */
  gc?: (missionId: string) => { removed: number };
}
