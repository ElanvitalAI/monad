// ── 프레임 저널 owner(실행 컨트롤러) 관측 (P5.1 · 2026-07-20) ─────────────────
//
// ★ PLAN-mission-build-pipeline-timetravel-statemachine P5. "coordinator(FLOW)를 저널 owner 로 승격·
//   이중 write 방지·owner 플래그 단일화"의 **안전한 관측 버전**. 실 컨트롤러 cutover(shadow→실 controller)는
//   투기적·고위험이라 보류하고, 먼저 프레임이 어느 컨트롤러(coordinator/sequential)로 쓰였는지 기록(P5·via)한
//   뒤, 한 저널이 **여러 컨트롤러로 쓰였는지(drift)** 를 감지한다 — 이게 "이중 write 방지"의 관측 관문.
//
// 순수 함수. via 미상(pre-P5) 프레임은 집계 제외(하위호환).

import type { PipelineFrame } from './frame-types.js';

export type Controller = 'coordinator' | 'sequential';

export interface ControllerOwnership {
  /** 저널에 나타난 서로 다른 컨트롤러(via) 집합. */
  owners: Controller[];
  /** 컨트롤러별 프레임 수. */
  counts: Record<Controller, number>;
  /** 2개 이상 컨트롤러가 같은 저널을 씀 = owner 단일성 위반(이중 컨트롤·config flip 등). */
  drift: boolean;
  /** via 태그된 프레임 수(pre-P5 undefined 제외). */
  tagged: number;
}

/** 저널의 컨트롤러 소유 관측(순수) — via 태그 집계 + drift 판정. */
export function detectControllerDrift(frames: readonly PipelineFrame[]): ControllerOwnership {
  const counts: Record<Controller, number> = { coordinator: 0, sequential: 0 };
  let tagged = 0;
  for (const f of frames) {
    if (f.via === 'coordinator' || f.via === 'sequential') { counts[f.via]++; tagged++; }
  }
  const owners = (['coordinator', 'sequential'] as Controller[]).filter((c) => counts[c] > 0);
  return { owners, counts, drift: owners.length > 1, tagged };
}
