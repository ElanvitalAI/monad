// 독립 하니스 런 컨텍스트 진입 — 액션레벨 셋업 공유 substrate (U4b·2026-07-25)
//
// self implement CLI 액션이 인라인으로 하던 3단 셋업(index.ts §self implement)을 재사용 헬퍼로 추출한다.
// 목적: runDevPipeline 재라우팅 시 이 셋업을 잃지 않고(무손실) 여러 진입점(self implement·elanous dev·향후 chat)이
// 한 곳에서 같은 셋업을 공유하게 한다. 3단:
//   1. harness-space 마커 env — "나는 self-dev 격리 하니스 공간의 elanous"임을 self-recognize(+상속 자식). 이미
//      심겼으면(오케스트레이터 자식) 존중(덮어쓰기 금지·N잡 충돌 방지).
//   2. run-identity mint-once(ensureRunId) — 최외곽 coordinator per-run join anchor(ELANOUS_RUN_ID). 자식 상속.
//   3. standalone log-sink 등록 — 독립 프로세스는 nexus StoreSink 미상속 → 이 sink 없으면 debug.log 가 logs.db 에
//      안 닿아 `elanous logs` 조회 불가(= 관측 안 한 것·제1원칙 위반). 공간 surface(harness:<kind>)로 등록. fail-open.
//
// 계약: [[PLAN-unified-selfdev-cli-runDevPipeline-2026-07-25]] §7 U4b · [[harness-space]](SSOT).

import {
  HARNESS_SPACE_ID_ENV, harnessSpaceEnv, harnessSpaceSurface, normalizeSpaceId, ensureRunId, getHarnessSpace,
  type HarnessSpace, type HarnessSpaceKind,
} from './harness-space.js';

export interface StandaloneRunContext {
  /** per-run join anchor(mint 또는 상속). */
  runId: string;
  /** 진입한 하니스 공간(마커 없으면 null — 방어적, 정상 진입 후엔 non-null). */
  space: HarnessSpace | null;
}

/**
 * 순수 env 셋업 — space 마커(미설정 시만) + runId mint-once. 부작용 = env 쓰기(의도적·자식 `...process.env`
 * 상속으로 전파). 로그/네트워크 없음 → 테스트 가능. 관측(log-sink·debug.log)은 enterStandaloneHarnessRun 몫.
 *
 * @param kind      이 격리 공간을 연 자율 실행 종류(self-implement 등).
 * @param spaceSeed 공간 id 파생 시드(예: feature slug). 이미 SPACE_ID 있으면(오케스트레이터 자식) 무시·존중.
 */
export function setupStandaloneRunEnv(
  kind: HarnessSpaceKind,
  spaceSeed: string,
  env: NodeJS.ProcessEnv = process.env,
): StandaloneRunContext {
  // 오케스트레이터가 잡별 구별 space id 를 자식 env 로 이미 심었으면 존중(덮어쓰면 N잡이 seed 로 충돌).
  if (!env[HARNESS_SPACE_ID_ENV]) {
    Object.assign(env, harnessSpaceEnv(kind, normalizeSpaceId(spaceSeed)));
  }
  // 최외곽 coordinator → per-run join anchor mint-once(자식은 상속·재mint 금지·harness-space §K 불변식).
  const runId = ensureRunId(env);
  const space = getHarnessSpace(env);
  return { runId, space };
}

export interface EnterStandaloneRunDeps {
  env?: NodeJS.ProcessEnv;
  /** logs.db sink 등록(테스트 주입). 기본 registerStandaloneLogSink. */
  registerSink?: (surface: string) => Promise<void>;
  /** 관측 emit(테스트 주입). 기본 debug.log. */
  debugLog?: (category: string, event: string, data?: unknown) => void;
}

/**
 * 독립 하니스 런에 진입 — env 셋업(순수) + 관측 배선(fail-open). self implement CLI·elanous dev·향후 chat 이
 * 공유하는 액션레벨 셋업 substrate. 관측 배선 실패는 삼킨다(파일 트레일이 진실원). 반환 = 확정된 runId/space.
 */
export async function enterStandaloneHarnessRun(
  o: { kind: HarnessSpaceKind; spaceSeed: string; via?: string },
  deps: EnterStandaloneRunDeps = {},
): Promise<StandaloneRunContext> {
  const env = deps.env ?? process.env;
  const ctx = setupStandaloneRunEnv(o.kind, o.spaceSeed, env);
  const via = o.via ?? 'cli';
  try {
    const debugLog = deps.debugLog ?? (await import('../debug/log.js')).debug.log;
    const registerSink = deps.registerSink ?? (await import('../domains/standalone-log-sink.js')).registerStandaloneLogSink;
    await registerSink(ctx.space ? harnessSpaceSurface(ctx.space) : 'harness');
    if (ctx.space) debugLog('harness.space', 'entered', { kind: ctx.space.kind, id: ctx.space.id, runId: ctx.space.runId, via });
    debugLog('run-identity', 'bind', { runId: ctx.runId, kind: o.kind, outermost: true, via });
  } catch { /* fail-open — 파일 트레일이 진실원 */ }
  return ctx;
}
