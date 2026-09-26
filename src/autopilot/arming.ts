// ── Autopilot Arming (2026-07-08 · P2/P3 안전 게이트) ─────────────────────
//
// self-improving 흐름(흡수→PR 초안→merge→재부팅)의 자율 경계 게이트. 매매 mandate
// (finance-trade-mandate.json)와 동형: git 밖 전용 json(~/.elanous/autopilot.json)을
// 대표가 편집해야 자율이 열린다. 부재/손상 = fail-closed(전부 disarmed·안전).
//
// 3 게이트(RESEARCH §7 자율 경계):
//   absorb  P2 — 흡수 후보 → delegate PR 초안 + 빌드/테스트 증거(코드작성 자율)
//   merge   P3 — mandate(비핵심 모듈) 내 자동 merge
//   reboot  P3 — 재빌드→재부팅(대표 확정: 마지막에 무조건 HITL·arming 무관)
//
// 기본 전부 false. armed 여도 상위 안전 3종(빌드/테스트 게이트·롤백·불변 코어)이 유지.

import { readFileSync, existsSync } from 'node:fs';
import { elanousStateRoot } from './state-paths.js';
import { join } from 'node:path';

/** [ISO-3] ELANOUS_STATE_DIR 존중(lazy) — test 루트에 부재 = fail-closed(DISARMED). */
export function autopilotArmingPath(): string {
  return join(elanousStateRoot(), 'autopilot.json');
}

export interface AutopilotArming {
  /** SE5 — 발굴(roadmap-scan·ref-dig·READ-ONLY·기본 on·안전). off 면 발굴 사이클 정지. */
  discover: { armed: boolean };
  /** SE5 — 제안 생성(플랜 초안·미션 인입·기본 on). off 면 발굴해도 제안 안 함. */
  propose: { armed: boolean };
  /** P2 — 흡수 후보 → delegate 코드작성 PR 초안 자율(기본 off). */
  absorb: { armed: boolean; backend: string };
  /** P3 — mandate 내 자동 merge(기본 off). */
  merge: { armed: boolean };
  /** P3 — 재부팅(기본 off·arming 무관하게 최종 HITL 확인 필요). */
  reboot: { armed: boolean };
  /** 계보 — armed 미션(대표 승인·spec 보유)을 자동 materialize(기본 off).
   *  command 자동생성은 여전히 금지 — spec 은 HITL 승인 시 명시된 것만. */
  materialize: { armed: boolean };
  /** SE4 — 승인된 발굴 미션을 격리 worktree 에서 자율 구현(nocturnal runner·기본 off).
   *  off 면 runNocturnal 이 skeleton(집행 0). merge 는 별도 HITL(build 만으론 merge 안 함). */
  build: { armed: boolean; backend: string };
  /** A4 §12.5 — 부작용 없는(research/business·매매·코드변경 아님) 발굴 미션을 research
   *  mandate 범위 내면 HITL 스킵하고 자동 수용(status=armed·기본 off·fail-closed). 매매·코드
   *  변경 discovery 는 이 게이트와 무관하게 항상 proposed(HITL). */
  autoAccept: { armed: boolean };
  /** PLAN O6-arm(2026-07-13) — 페이즈 실패의 저위험 힐(transient 재시도 1회)만 자율 실행
   *  (기본 off·fail-closed). 분할/골정정/건너뛰기 등 판단 힐은 이 게이트와 무관하게 항상 HITL. */
  selfHeal: { armed: boolean };
  /** R3(RFC-autonomous-pr-review §3f·2026-07-20) — 자율 PR 리뷰 verdict=pass(clean) 페이즈를 미션
   *  완료 시 자동 머지(기본 off·fail-closed·머지=HITL 불변에 대한 opt-in 구멍). off 면 종전대로 HITL
   *  머지 승인 대기. escalate(미수렴 리뷰) 페이즈는 [REVIEW:ESCALATED] 로 항상 제외. 매매 mandate 동형. */
  reviewAutoMerge: { armed: boolean };
}

/** 기본값 — 위험 게이트(absorb/merge/reboot/build/materialize)는 fail-closed(off),
 *  READ-ONLY 발굴/제안(discover/propose)은 기본 on(안전·SE5). 파일 부재/손상 시 이 값. */
export const DISARMED: AutopilotArming = {
  discover: { armed: true },
  propose: { armed: true },
  absorb: { armed: false, backend: 'claude' },
  merge: { armed: false },
  reboot: { armed: false },
  materialize: { armed: false },
  build: { armed: false, backend: 'claude' },
  autoAccept: { armed: false },
  selfHeal: { armed: false },
  reviewAutoMerge: { armed: false },
};

/** ~/.elanous/autopilot.json 로드 — 부재/손상/타입불일치 = fail-closed(DISARMED).
 *  path 주입으로 테스트 가능. armed 는 명시 true 만 인정(그 외 전부 false). */
export function loadAutopilotArming(path: string = autopilotArmingPath()): AutopilotArming {
  try {
    if (!existsSync(path)) return DISARMED;
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, any>;
    return {
      absorb: {
        armed: raw?.absorb?.armed === true,
        backend: typeof raw?.absorb?.backend === 'string' ? raw.absorb.backend : 'claude',
      },
      // discover/propose = READ-ONLY·기본 on(명시 false 만 off). 나머지는 명시 true 만 on.
      discover: { armed: raw?.discover?.armed !== false },
      propose: { armed: raw?.propose?.armed !== false },
      merge: { armed: raw?.merge?.armed === true },
      reboot: { armed: raw?.reboot?.armed === true },
      materialize: { armed: raw?.materialize?.armed === true },
      build: {
        armed: raw?.build?.armed === true,
        backend: typeof raw?.build?.backend === 'string' ? raw.build.backend : 'claude',
      },
      autoAccept: { armed: raw?.autoAccept?.armed === true },
      selfHeal: { armed: raw?.selfHeal?.armed === true },
      reviewAutoMerge: { armed: raw?.reviewAutoMerge?.armed === true },
    };
  } catch {
    return DISARMED; // 손상 = fail-closed
  }
}

/** 계보 자동 materialize arming 여부(편의). 기본 off(fail-closed). */
export function materializeArmed(path: string = autopilotArmingPath()): boolean {
  return loadAutopilotArming(path).materialize.armed;
}

/** SE4 격리 자율 구현(nocturnal) arming 여부(편의). 기본 off(fail-closed). */
export function buildArmed(path: string = autopilotArmingPath()): boolean {
  return loadAutopilotArming(path).build.armed;
}

/** A4 §12.5 — 부작용 없는 발굴 미션 자동수용 arming 여부(편의). 기본 off(fail-closed). */
export function autoAcceptArmed(path: string = autopilotArmingPath()): boolean {
  return loadAutopilotArming(path).autoAccept.armed;
}

/** PLAN O6-arm — 저위험 셀프 힐(transient 재시도) 자율 실행 arming 여부. 기본 off(fail-closed). */
export function selfHealArmed(path: string = autopilotArmingPath()): boolean {
  return loadAutopilotArming(path).selfHeal.armed;
}

/** R3(RFC-autonomous-pr-review §3f) — 리뷰 PASS(clean) 페이즈 완료 시 자동 머지 arming 여부.
 *  기본 off(fail-closed·머지=HITL 불변). on 이어도 escalated 페이즈는 항상 제외(mergeMissionPhases). */
export function reviewAutoMergeArmed(path: string = autopilotArmingPath()): boolean {
  return loadAutopilotArming(path).reviewAutoMerge.armed;
}
