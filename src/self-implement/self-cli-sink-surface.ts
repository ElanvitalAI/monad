// ── `monad self <sub>` 의 로그 sink surface 결정 (2026-07-30) ──────────────────
//
// ⛔ **왜 필요한가** — 독립 프로세스는 데몬의 StoreSink 를 상속하지 않는다. 등록 안 하면 그
// 프로세스의 `debug.log(...)` 가 **logs.db 에 안 닿아** `monad logs` 로 조회 불가다(= 관측 안 한 것).
// 그런데 등록이 **액션마다 손으로** 붙어 있어 빠뜨리기 쉬웠다. 실측(2026-07-30 · `main` 1c527191a):
//
//   ✅ author · orchestrate · parked · repair-signals · review · utterance
//   ⛔ **implement** · typecheck · screen · run · log · provision · recall · capability · capabilities
//
// ⭐ `self implement` 는 문서가 가리키는 self-build 진입점인데 관측이 통째로 유실됐다. 같은
// 파이프라인을 `monad dev` 로 타면 관측되고 `self implement` 로 타면 안 되는 **입구별 비대칭**이었다.
// ⊕ 같은 결함이 이 레포에서 **세 번째**다: `self review`(sink 가 `if (useAcp)` 안) · `self author`
// (#5930) · 그리고 이 census. ⇒ **하나씩 고치는 대신 빼먹을 수 없게 만든다.**
//
// 선례 = `agentCmd.hook('preAction')` — 주석이 이유까지 적어 뒀다: *"각 액션의 개별
// registerStandaloneLogSink 를 대체(중복 싱크 방지·전 서브커맨드가 logs.db 도달)"*.

/** `monad dev` 등록과 자식 provider 오류 조회가 함께 쓰는 sink surface. */
export const DEV_PIPELINE_SINK_SURFACE = 'dev-pipeline';

/** 기존에 등록하던 액션의 surface 를 **그대로 보존**한다 — 관측 attribution 계약은 안 바뀐다. */
const SELF_SURFACE_BY_SUB: Readonly<Record<string, string>> = {
  utterance: 'utterance',
};

/**
 * ⭐ `self <sub>` 가 등록할 sink surface. 표에 없으면 `'harness'`(기존 다수와 동일).
 *
 * ⛔ `review` 는 **null** 이다 — `runSelfReviewCliCommand` 가 `deps.registerSink('self-review')` 로
 * **자기 seam 안에서** 등록하고 그것이 런타임 테스트로 잠겨 있다(`self-review-cli.test.ts`).
 * 훅이 또 등록하면 **싱크가 둘**이 되어 같은 줄이 두 번 적재된다. ⇒ 훅은 비켜 준다.
 */
export function selfCliSinkSurface(sub: string): string | null {
  if (sub === 'review') return null;
  return SELF_SURFACE_BY_SUB[sub] ?? 'harness';
}
