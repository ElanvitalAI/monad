// 미션 안착 점검 실행 (회고 에이전트 C1 · P2) — 미션 읽기전용 → 결정론 회고 → surface_events 각인.
//
//   bun scripts/mission-retro.ts <missionId>            # 회고만(각인 안 함·미리보기)
//   bun scripts/mission-retro.ts <missionId> --imprint  # surface_events 각인(다음 분해 능동회상 재사용)
//
// ⚠️ 미션 DB 무접촉(읽기만) · 각인은 surface_events 만 · armed=false. 미션 완료훅 자동 트리거는
//    미션코드 조율 필요 = follow-up(현재는 수동/retro-cycle 호출용).

import { openAutopilotMissionsDb } from '../src/autopilot/mission-registry.js';
import {
  retrospectMission,
  renderMissionReflection,
  imprintMissionReflection,
  retrospectMissionFeedback,
  renderMissionFeedback,
  imprintMissionFeedback,
  type RetroArc,
} from '../src/autopilot/mission-retrospect.js';

const missionId = process.argv[2];
if (!missionId || missionId.startsWith('--')) {
  console.error('usage: bun scripts/mission-retro.ts <missionId> [--imprint]');
  process.exit(1);
}
const doImprint = process.argv.includes('--imprint');

const store = openAutopilotMissionsDb();
try {
  const m = store.getMission(missionId) as
    | { id?: string; intent?: string; title?: string; autopilot?: { arcs?: RetroArc[] } }
    | null;
  if (!m) {
    console.error(`미션 ${missionId} 없음`);
    process.exit(1);
  }
  const reflection = retrospectMission({
    id: m.id ?? missionId,
    goal: m.intent ?? m.title ?? '',
    arcs: Array.isArray(m.autopilot?.arcs) ? m.autopilot!.arcs! : [],
  });

  console.log(renderMissionReflection(reflection));
  console.log('\n--- arcs ---');
  console.log(JSON.stringify(reflection.arcs, null, 2));

  // C2 — 진행 간 피드백 회고(워킹메모리 provenance).
  const feedback = retrospectMissionFeedback(m.id ?? missionId);
  console.log('\n' + renderMissionFeedback(feedback));

  if (doImprint) {
    const retroId = imprintMissionReflection(reflection);
    const fbId = imprintMissionFeedback(feedback);
    console.log(`\n각인됨 — 안착(mission.retro): ${retroId} · 피드백(mission.feedback): ${fbId}`);
  } else {
    console.log('\n(각인 생략 — --imprint 로 surface_events 각인)');
  }
} finally {
  const closable = store as unknown as { close?: () => void };
  closable.close?.();
}
