// ── Self-Evolution SE2/SE4 경계 · BuildTarget (2026-07-10) ────────────────
//
// 근본 통합(대표 결정): "proposal"은 별도 개념이 아니라 발굴에서 나온 승인 대기 미션 +
// 플랜 초안 문서일 뿐 — Mission 의 특수 케이스. 그래서 별도 proposal-queue 를 없애고,
// 미션이 유일한 승인/계보 단위가 된다. SE4 야간러너는 미션 타입에 결합하지 않고 이
// **좁은 BuildTarget 인터페이스**만 소비한다(깨끗한 경계·역결합 방지).
//
// 플랜 초안 = 미션 아티팩트. 미션 id 로 키잉된 온-디스크 md(스키마 변경 없음·누구나
// 미션에서 경로 유도). ~/.monad 관례(monad 상태는 git 밖)·자동 발굴 크론의 git 노이즈 회피.

import { homedir } from 'node:os';
import { monadStateRoot } from '../state-paths.js';
import { join } from 'node:path';
import { slugify } from '../proposal/draft-plan.js';
import type { MissionRow } from '../mission-registry.js';

/** SE4 야간러너가 소비하는 최소 계약 — 미션/제안 표현에 독립. */
export interface BuildTarget {
  id: string;        // 미션 id(markBuilt·계보 refs)
  slug: string;      // git 브랜치/worktree 명명(se/<slug>)
  title: string;     // 로깅·PR 제목
  planPath: string;  // 구현 입력 플랜 초안 md 경로(온-디스크 아티팩트)
}

/** 플랜 초안 아티팩트 경로 — 미션 id 로 결정론적. git 밖(~/.monad).
 *  core 미션 fabric = autopilot/ (conatus/ 는 투자 customer 네임스페이스·대표 정정 2026-07-11). */
export function proposalDraftPath(missionId: string): string {
  return join(monadStateRoot(), 'autopilot/proposals', `${missionId}.md`);
}

/** 미션 → BuildTarget 매핑. slug=goal 슬러그화(브랜치명), planPath=id 유도. */
export function missionToBuildTarget(m: MissionRow): BuildTarget {
  return {
    id: m.id,
    slug: slugify(m.goal),
    title: m.goal,
    planPath: proposalDraftPath(m.id),
  };
}
