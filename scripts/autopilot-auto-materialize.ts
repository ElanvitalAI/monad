#!/usr/bin/env bun
// ── Autopilot 자율 materialize 실행기 (#2 · 2026-07-09) ────────────────────
// arming.materialize ON 이면 armed+spec 미션(대표 HITL 승인분)을 자동 materialize.
// off(기본·fail-closed)면 no-op. command 자동생성 없음 — spec 은 승인 시 명시된 것만.
// 크론 등록 예(대표 arming ON 후): monad schedule create --cron "*/15 * * * *"
//   --command "scripts/autopilot-auto-materialize.ts" 후 adopt. arming OFF면 무해.

import { autoMaterializeArmed } from '../src/autopilot/mission-engine.js';
import { sweepFiniteMissions } from '../src/autopilot/mission-lifecycle.js';
import { ensureCronNodePath } from '../src/domains/cron-path.js';
ensureCronNodePath();

// 유한 미션 자동종료(파생 태스크 all done → 미션 done) — mandate 무관·항상 안전.
const swept = sweepFiniteMissions();
if (swept.completed > 0) console.log(`[auto-materialize] 유한 미션 ${swept.completed} 자동종료: ${swept.ids.join(', ')}`);

const r = await autoMaterializeArmed();
if (!r.armed) {
  console.log('[auto-materialize] mandate disarmed — no-op(fail-closed)');
  process.exit(0);
}
console.log(`[auto-materialize] mandate armed · materialized ${r.materialized} · skipped ${r.skipped} / ${r.results.length}`);
for (const x of r.results) {
  const tag = x.ok ? 'OK' : x.skipped ? 'SKIP' : 'FAIL';
  console.log(`  ${tag} ${x.id} (${x.engine ?? '?'})${x.error ? ' - ' + x.error : ''}${x.skipped ? ' - ' + x.skipped : ''}`);
}
