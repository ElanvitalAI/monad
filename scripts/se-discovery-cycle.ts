#!/usr/bin/env bun
// ── Self-Evolution · 발굴→제안(미션) 사이클 실행 (2026-07-09) ──────────────
// 내부 미구현 로드맵(1순위) + 외부 참조 repo 흡수 후보(2순위) + preexisting 빨강(3순위) 발굴.
// 사용: bun scripts/se-discovery-cycle.ts [--sync] [--missions]

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { scanDocs } from '../src/autopilot/discovery/doc-inventory.js';
import { rankUnimplemented, filterAlreadyImplemented, countStrongTopicMatches, type UnimplementedPlan } from '../src/autopilot/discovery/roadmap-scan.js';
import { openSurfaceEventsDb, surfaceEventsDbPath, recallEvents } from '../src/domains/surface-events.js';
import { SELF_DOMAIN } from '../src/domains/self-awareness.js';
import { syncAllRefs, REF_REPOS } from '../src/autopilot/discovery/ref-sync.js';
import { digCommits, clusterByArea, synthesizeCandidates, type AbsorptionCandidate } from '../src/autopilot/discovery/ref-dig.js';
import { planProposals, type CyclePlan } from '../src/autopilot/discovery/discovery-cycle.js';
import { scanPreexistingRed, type PreexistingRedCandidate } from '../src/autopilot/discovery/preexisting-red-scan.js';
import { resolveLogTargets } from '../src/cli/logs-cli.js';
import { LogStore } from '../src/mss/logging/log-store.js';
import { intakeSeedsAsMissions } from '../src/autopilot/discovery-intake.js';
import type { RoadmapDecomposer } from '../src/autopilot/proposal/phased-plan.js';
import { TaskGenerator } from '../src/task-orchestrator/generator.js';
import { streamLLM, resolveDefaultProvider } from '../src/llm.js';
import { loadAutopilotArming } from '../src/autopilot/arming.js';
import { recordAutonomousActionSafe } from '../src/domains/autonomy-log.js';

const PREEXISTING_RED_OBSERVATION_LIMIT = 1_000;

type LogTarget = { readonly dbPath: string };
type GateBaselineRow = { readonly data: unknown; readonly ts: unknown };
type ReadonlyLogStore = { query(query: { exactCategories: string[]; events: string[]; limit: number }): readonly GateBaselineRow[]; close(): void };

export interface PreexistingRedObservationResult {
  readonly observations: readonly unknown[];
  readonly readableTargets: number;
  readonly unreadableTargets: number;
}

export interface PreexistingRedObservationDeps {
  readonly resolveTargets?: () => { readonly targets: readonly LogTarget[]; readonly error?: string };
  readonly openStore?: (dbPath: string) => ReadonlyLogStore;
  readonly pathExists?: (dbPath: string) => boolean;
}

/** 모든 로그 우주에서 gate.baseline 행을 읽는다. 한 우주가 실패해도 나머지 관측은 보존한다. */
export function collectPreexistingRedObservations(deps: PreexistingRedObservationDeps = {}): PreexistingRedObservationResult {
  const resolved = (deps.resolveTargets ?? (() => resolveLogTargets({ all: true, includeTest: true })))();
  if (resolved.error) throw new Error(resolved.error);
  const pathExists = deps.pathExists ?? existsSync;
  const openStore = deps.openStore ?? ((dbPath: string) => new LogStore(dbPath, { readonly: true }));
  const observations: unknown[] = [];
  let readableTargets = 0;
  let unreadableTargets = 0;

  for (const target of resolved.targets) {
    if (!pathExists(target.dbPath)) continue;
    let store: ReadonlyLogStore | undefined;
    try {
      store = openStore(target.dbPath);
      for (const row of store.query({
        exactCategories: ['self-implement'], events: ['gate.baseline'], limit: PREEXISTING_RED_OBSERVATION_LIMIT,
      })) {
        let data = row.data;
        if (typeof data === 'string') data = JSON.parse(data);
        observations.push(data && typeof data === 'object' ? { ...data as object, observedAt: row.ts, ts: row.ts } : data);
      }
      readableTargets += 1;
    } catch {
      unreadableTargets += 1;
    } finally {
      store?.close();
    }
  }
  return { observations, readableTargets, unreadableTargets };
}

/** 기존 1·2순위 제안에 스캔된 3순위 preexisting 빨강 후보를 더한다. */
export function planDiscoveryProposals(
  unimplemented: UnimplementedPlan[],
  absorption: AbsorptionCandidate[],
  preexistingRed: PreexistingRedCandidate[],
): CyclePlan[] {
  return planProposals({ unimplemented, absorption, preexistingRed, internalCap: 3, externalCap: 2 });
}

function makeRoadmapDecomposer(): RoadmapDecomposer {
  const provider = resolveDefaultProvider(undefined);
  const gen = new TaskGenerator({
    callable: async ({ prompt, signal }) => {
      const text = await streamLLM([{ role: 'user', content: prompt }], () => {}, { ...(provider ? { provider } : {}), ...(signal ? { signal } : {}) });
      return { text, modelId: provider?.name };
    },
  });
  return async (objective) => {
    try { return (await gen.decompose({ objective, constraints: { maxTasks: 7 }, goalKind: 'coding', depth: 0 })).proposal; }
    catch { return null; }
  };
}

function makeSelfRecall(): ((query: string) => Promise<{ hits: number }>) | undefined {
  if (!existsSync(surfaceEventsDbPath())) return undefined;
  return async (query) => {
    const db = openSurfaceEventsDb();
    try { return { hits: countStrongTopicMatches(recallEvents(db, { domain: SELF_DOMAIN, query, sinceHours: 720, limit: 40, bump: false }), query) }; }
    catch { return { hits: 0 }; } finally { db.close(); }
  };
}

export async function runDiscoveryCycle(args = process.argv): Promise<void> {
  const repoRoot = join(import.meta.dir, '..');
  const nowMs = Date.now();
  const doSync = args.includes('--sync');
  const doMissions = args.includes('--missions');
  const doDecompose = args.includes('--decompose');
  const arming = loadAutopilotArming();
  if (!arming.discover.armed) {
    console.log('[arming] discover disarmed — 발굴 사이클 정지(대표 arming 대기).');
    return;
  }

  const { live, likelyDone } = await filterAlreadyImplemented(rankUnimplemented(scanDocs(join(repoRoot, 'docs')), { nowMs }), makeSelfRecall());
  const unimplemented = live.slice(0, 6);
  if (likelyDone.length) console.log(`[self_recall 교차] 이미 구현 개연성으로 강등된 유령 로드맵 ${likelyDone.length}건: ${likelyDone.slice(0, 5).map(p => p.topic).join(', ')}`);

  let absorption: AbsorptionCandidate[] = [];
  if (doSync) for (const result of syncAllRefs()) console.log(`[sync] ${result.key}: ${result.note}`);
  for (const repo of REF_REPOS) absorption.push(...synthesizeCandidates(repo.key, clusterByArea(digCommits(repo.dir, null, undefined, 40)), 2));
  absorption = absorption.sort((a, b) => b.score - a.score).slice(0, 4);

  const collected = collectPreexistingRedObservations();
  const preexistingRed = scanPreexistingRed(collected.observations);
  const plans = planDiscoveryProposals(unimplemented, absorption, preexistingRed);
  console.log(`\n발굴: 내부 미구현 ${unimplemented.length} · 외부 흡수후보 ${absorption.length} · 로그 우주 읽음 ${collected.readableTargets} · 못 읽음 ${collected.unreadableTargets} · preexisting 빨강 후보 ${preexistingRed.length} → 제안 ${plans.length}건\n`);
  for (const plan of plans) console.log(`  ${plan.rank}. [${plan.seed.source === 'internal-roadmap' ? '내부' : plan.seed.source === 'preexisting-red' ? 'preexisting 빨강' : '외부'}·${plan.seed.tier}] ${plan.seed.title}`);

  if (doMissions && !arming.propose.armed) {
    console.log('\n[arming] propose disarmed — 발굴은 했으나 미션 인입 skip(대표 arming 대기).');
  } else if (doMissions) {
    if (doDecompose) console.log('\n[--decompose] internal-roadmap 미션은 TOX 멀티페이즈 분해(LLM 비용 발생)');
    const result = await intakeSeedsAsMissions(plans.map(plan => plan.seed), { repoRoot, ...(doDecompose ? { decomposeRoadmap: makeRoadmapDecomposer() } : {}) });
    console.log(`\n[미션 인입] 신규 ${result.created}건 · dedup skip ${result.skipped}건 (플랜 초안 아티팩트 동반)`);
    for (const mission of result.missions) console.log(`  + ${mission.model} · ${mission.goal}  (${mission.id})`);
    for (const mission of result.missions) recordAutonomousActionSafe({ loop: 'autopilot', action: `발굴 미션 인입: ${mission.goal}`, rationale: '자율 발굴 후보를 미션으로 자동 인입(proposed·실행은 승인 후)', refs: { missionId: mission.id } });
  } else {
    console.log('\n[미리보기 · --missions 로 미션 자동 인입 + 플랜 초안 기록]');
  }
}

if (import.meta.main) await runDiscoveryCycle();
