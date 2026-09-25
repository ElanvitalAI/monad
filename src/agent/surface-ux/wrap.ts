// wrapAutonomousTool — 무거운 자율툴 델리게이션 래퍼 (2026-07-20).
//
// PLAN-cross-surface-ux-adapter §3c. SelfImplement·delegate·autopilot mission·terminal 등
// 어떤 무거운 자율툴이든 감싸, 지금 각 dispatcher 에 흩어진 공통 관심사를 **한 겹**에 모은다:
//   ⑩ nest-cap 게이트(재귀 폭주 차단·messenger 스택 parity)
//   ▸ 시작 진행 ack(수분 침묵 완화)
//   ▸ ctx → SurfaceUx 변환(툴은 4필드 저글링 안 함)
//   ▸ 큰 결과 spill(요약만 반환)
// 코어(runSelfImplement·mission runner)는 무손상 — SurfaceUx→seam 매핑은 spec.run 안에서.

import { nestCapReached, nestInfo } from '../nest-depth.js';
import { debug } from '../../debug/log.js';
import { surfaceUxFromDispatchCtx, type SurfaceUxSource } from './build.js';
import type { SurfaceKind, SurfaceSpillFile, SurfaceUx } from './types.js';

/** 래퍼가 코어를 굴리는 데 필요한 ctx — DaemonToolDispatchCtx 가 구조적으로 만족. */
export interface WrapAutonomousCtx extends SurfaceUxSource {
  signal?: AbortSignal;
  cwd?: string;
}

/** 무거운 자율툴 1개의 명세. run 안에서 SurfaceUx 를 코어의 seam 으로 매핑한다. */
export interface AutonomousToolSpec<Result> {
  /** nest-cap 거부 메시지용 툴 이름(들). */
  toolNames: readonly string[];
  /** 로그/진행 라벨(예: 'SelfImplement'). */
  label: string;
  /** 시작 진행 문구. 생략 시 `🔨 <label> 시작…`. */
  startMessage?: string;
  /** 코어 실행 — SurfaceUx 로 승인/질문/진행을 위임받아 코어 seam 으로 매핑. */
  run(input: {
    args: Record<string, unknown>;
    ux: SurfaceUx;
    ctx: WrapAutonomousCtx;
  }): Promise<Result>;
  /** 결과 렌더 — 큰 본문은 spill 로 넘기고 요약만 반환하도록 분리(선택). */
  render?(result: Result): { summary: unknown; spill?: SurfaceSpillFile };
}

/** nest-cap 초과 시 LLM 에 돌려줄 구조화 거부. daemon-tools 의 dispatch 거부와 동형. */
function nestRefusal(label: string): { error: string; nest: ReturnType<typeof nestInfo> } {
  const nest = nestInfo();
  return {
    error: `${label} refused: nest cap reached (depth ${nest.depth}/${nest.max}). 재귀 액자 상한 — 더 깊은 자율 spawn 차단.`,
    nest,
  };
}

/**
 * 자율툴을 서피스-무관 UX 로 감싼다. 반환값은 LLM 이 소비할 dispatch 결과(요약/에러).
 *
 * - nest-cap 초과 → 즉시 구조화 거부(코어 미실행).
 * - 시작 시 progress ack.
 * - spec.run 에 SurfaceUx 주입 → 코어가 승인/질문/진행/spill 을 서피스로 위임.
 * - spec.render 가 spill 을 주면 첨부하고 요약만 반환.
 */
export async function wrapAutonomousTool<Result>(
  spec: AutonomousToolSpec<Result>,
  args: Record<string, unknown>,
  ctx: WrapAutonomousCtx,
  opts?: { surface?: SurfaceKind },
): Promise<unknown> {
  // ⑩ nest-cap — messenger 스택엔 이 게이트가 없었다(daemon-tools 만 있었음). 래퍼가 parity 확보.
  if (nestCapReached()) {
    debug.log('surface-ux.wrap', 'nest-cap-refused', { label: spec.label, ...nestInfo() });
    return nestRefusal(spec.label);
  }

  const ux = surfaceUxFromDispatchCtx(ctx, opts?.surface ? { surface: opts.surface } : undefined);
  debug.log('surface-ux.wrap', 'start', { label: spec.label, surface: ux.surface, interactive: ux.interactive });
  ux.progress(spec.startMessage ?? `🔨 ${spec.label} 시작 (수분 소요될 수 있음)…`, { phase: 'start' });

  try {
    const result = await spec.run({ args, ux, ctx });
    if (spec.render) {
      const { summary, spill } = spec.render(result);
      if (spill) ux.spillFile(spill);
      ux.progress(`✅ ${spec.label} 완료`, { phase: 'end' });
      return summary;
    }
    ux.progress(`✅ ${spec.label} 완료`, { phase: 'end' });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    debug.log('surface-ux.wrap', 'error', { label: spec.label, message }, { level: 'error' });
    ux.progress(`⚠️ ${spec.label} 실패: ${message}`, { phase: 'end' });
    return { error: `${spec.label} failed: ${message}` };
  }
}
