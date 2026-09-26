#!/usr/bin/env bun
// ── 투자 오토파일럿 미션 앵커 + 크론 fan-in 태깅 (관측성·2026-07-11) ─────────────
//
// 대표 지적: 투자 사이클들을 raw 크론으로만 등록해 미션 fabric 에서 관측이 안 됨. 이 스크립트가
// ① 적응형 투자 오토파일럿을 대표하는 **coordinator 앵커 미션**을 만들고(멱등) ② 모든 투자 크론을
// 그 apm_id 로 태깅(schedule_registry.autopilot_id·setScheduleMission)해 **fan-in 관측**을 연다.
// 이후 `elanous autopilot trace <apm>` / PWA /autopilot 미션 트리에서 25 사이클 계보가 보인다.
//
// 안전: 메타데이터(계보 태그)만 설정 — 크론 스케줄/실행 무변경. READ-except-tag. 멱등.

import { openAutopilotMissionsDb, createMission, listMissions } from '../src/autopilot/mission-registry.js';
import { openSchedulesDb, listSchedules, setScheduleMission } from '../src/domains/schedule-registry.js';

const ANCHOR_PREFIX = '적응형 투자 오토파일럿 — 운영 조율(coordinator)';
const ANCHOR_GOAL = `${ANCHOR_PREFIX}. 신호 수집(커뮤니티/속보/국면/공시/수급) → 2단 게이팅(1차 규칙·2차 luna) → 반응형 렌즈(심화) → 라우팅(알림) → canary 집행 → 사후검증 → 발굴, 그리고 계약 에이전트(캡스톤·레버·자유스윙) blackboard fan-in 코디네이션. 이 미션 아래 모든 투자 사이클이 파생물로 관측된다.`;

// 투자 오토파일럿 소속 크론 name 매칭(basename).
const INVEST_PATTERNS = [
  'signal-', 'regime-refresh', 'community-buzz', 'x-breaking', 'dart-disclosure',
  'kr-investor', 'flow-signal', 'contract-coordinator', 'backtest-cycle', 'oos-verify',
  'buzz-validate', 'buzz-discovery', 'buzz-dict-evolve', 'retro-cycle', 'weekly-alpha',
  'run-free-swing', 'run-leverage', 'run-attractiveness',
];
const isInvest = (name: string): boolean => INVEST_PATTERNS.some((p) => name.includes(p));

function main(): void {
  // ① 앵커 coordinator 미션(멱등 — goal prefix 로 재사용).
  const store = openAutopilotMissionsDb();
  let anchor = listMissions(store, {}).find((m) => m.goal.startsWith(ANCHOR_PREFIX));
  if (!anchor) {
    anchor = createMission(store, {
      goal: ANCHOR_GOAL, source: 'manual', status: 'running',
      triage: { executionModel: 'coordinator', domain: 'investment', tier: 'heavy', engine: 'orchestrator', rationale: '적응형 투자 오토파일럿 운영 관측 앵커', confidence: 'high' },
    });
    console.log(`앵커 미션 생성: ${anchor.id}`);
  } else {
    console.log(`앵커 미션 재사용: ${anchor.id} (status=${anchor.status})`);
  }
  const apmId = anchor.id;

  // ② 투자 크론 fan-in 태깅.
  const sdb = openSchedulesDb();
  try {
    const rows = listSchedules(sdb, {});
    const invest = rows.filter((r) => isInvest(r.name));
    let tagged = 0;
    for (const r of invest) { setScheduleMission(sdb, r.id, apmId); tagged += 1; }
    console.log(`\nfan-in 태깅: ${tagged}/${invest.length} 크론 → apm ${apmId}`);
    // ③ 관계도(계층별 그룹) 출력.
    const layer = (n: string): string =>
      /signal-pool|community-buzz|x-breaking|regime|dart|kr-investor|flow|attractiveness/.test(n) ? 'L1 수집/context'
      : /gate2/.test(n) ? 'L3 2차 게이트'
      : /signal-dig/.test(n) ? 'L3.5 반응형 렌즈'
      : /router|digest/.test(n) ? 'L4 라우팅'
      : /exec|outcome/.test(n) ? 'L5 집행/검증'
      : /contract-coordinator|run-free-swing|run-leverage/.test(n) ? 'L6 계약/코디네이터'
      : /resolution|backtest|oos|buzz-validate|buzz-discovery|buzz-dict|retro|weekly/.test(n) ? 'L7 발굴/심화'
      : 'etc';
    const byLayer = new Map<string, string[]>();
    for (const r of invest) { const l = layer(r.name); (byLayer.get(l) ?? byLayer.set(l, []).get(l)!).push(r.name); }
    console.log(`\n━ 관계도 (미션 ${apmId} fan-in) ━`);
    for (const l of ['L1 수집/context', 'L3 2차 게이트', 'L3.5 반응형 렌즈', 'L4 라우팅', 'L5 집행/검증', 'L6 계약/코디네이터', 'L7 발굴/심화', 'etc']) {
      const g = byLayer.get(l); if (!g?.length) continue;
      console.log(`  ${l}: ${g.sort().join(', ')}`);
    }
    console.log(`\n관측: elanous autopilot trace ${apmId}`);
  } finally { sdb.close(); }
}

main();
