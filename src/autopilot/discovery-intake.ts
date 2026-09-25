// ── Autopilot Discovery → Mission Intake (2026-07-09) ─────────────────────
//
// 대표 지시: "자율 발굴 → 미션 자동 인입." 발굴(discovery-cycle)이 찾은 후보
// (ProposalSeed)를 미션 시스템에 자동 인입 → 계보/조회/materialize 파이프라인 진입.
//
// 인입 미션은 status='proposed' — 자동 실행 안 됨(mandate 는 armed 만 자율 실행).
// 즉 "오토파일럿이 이런 걸 발굴했다"는 가시성만 제공, 실행은 arm(HITL) 후.
// dedup: 같은 goal(title) 미션이 이미 있으면 skip(재발굴 홍수 방지).

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openAutopilotMissionsDb, createMissionWithSlug, listMissions, type MissionRow } from './mission-registry.js';
import { triageGoal, type TriageCallable } from './triage.js';
import { buildPlanDraft, type ProposalSeed } from './proposal/draft-plan.js';
import { decomposeRoadmapToPlan, type RoadmapDecomposer } from './proposal/phased-plan.js';
import { proposalDraftPath } from './build/build-target.js';
import type { Domain } from './domain/types.js';
import { autoAcceptArmed } from './arming.js';
import {
  loadResearchMandate, evaluateResearchMandate,
  type ResearchMandate, type ResearchSideEffect,
} from '../domains/research-mandate.js';

/** 도메인 → 부작용 계급(§12.5). coding=코드변경·investment=매매 → 경계(HITL). business/general=없음. */
export function domainSideEffect(domain: Domain): ResearchSideEffect {
  if (domain === 'coding') return 'code';
  if (domain === 'investment') return 'trade';
  return 'none'; // business·general = 부작용 없는 지식 업무
}

export interface AutoAcceptDecision { autoAccept: boolean; reason: string }

/** 발굴 미션이 자동수용(HITL 스킵) 대상인가 — 부작용 없음 + research mandate 범위 + arming.
 *  매매·코드변경(코딩/투자 도메인)은 경계에서 항상 proposed. arming off 면 자격 있어도 proposed. */
export function decideAutoAccept(domain: Domain, mandate: ResearchMandate, armed: boolean): AutoAcceptDecision {
  const v = evaluateResearchMandate({ sideEffect: domainSideEffect(domain) }, mandate);
  if (!v.autoAccept) return { autoAccept: false, reason: v.reason };
  if (!armed) return { autoAccept: false, reason: 'autoAccept disarmed(대표 arming 필요·기본 off)' };
  return { autoAccept: true, reason: v.reason };
}

export interface IntakeResult {
  created: number;
  skipped: number;              // dedup(이미 존재)
  autoAccepted: number;         // §12.5 — HITL 스킵(status=armed)
  ids: string[];
  missions: Array<{ id: string; goal: string; model: string; source: string; status: string; autoAcceptReason?: string }>;
}

export interface IntakeDeps {
  classify?: TriageCallable;    // LLM triage refine(선택·주입)
  now?: () => Date;             // 시각 seam
  db?: ReturnType<typeof openAutopilotMissionsDb>;
  /** 플랜 초안 아티팩트 경로 resolver(테스트 seam). null 반환 시 초안 기록 skip. 기본 proposalDraftPath. */
  draftPathFor?: (missionId: string) => string | null;
  /** TOX 멀티페이즈 분해(주입·비용 있음). internal-roadmap seed 에만 적용. 미주입/실패 시 template. */
  decomposeRoadmap?: RoadmapDecomposer;
  /** repo 루트(로드맵 doc 읽기·기본 cwd). */
  repoRoot?: string;
  /** §12.5 자동수용 — research mandate(기본 loadResearchMandate). */
  researchMandate?: ResearchMandate;
  /** §12.5 자동수용 arming(기본 autoAcceptArmed()·fail-closed off). 테스트 seam. */
  autoAcceptArmed?: boolean;
  /** id 영문 slug 생성 seam(테스트 격리·luna 우회). 기본 generateMissionSlug. */
  slugFn?: (goal: string) => Promise<string>;
}

/** ProposalSeed[] → 미션(proposed·source=discovery) 자동 인입. dedup by goal. */
export async function intakeSeedsAsMissions(seeds: ProposalSeed[], deps: IntakeDeps = {}): Promise<IntakeResult> {
  const db = deps.db ?? openAutopilotMissionsDb();
  const ownDb = !deps.db;
  const researchMandate = deps.researchMandate ?? loadResearchMandate();
  const armed = deps.autoAcceptArmed ?? autoAcceptArmed();
  try {
    const existing = new Set(listMissions(db, {}).map((m: MissionRow) => m.goal.trim()));
    const ids: string[] = [];
    const missions: IntakeResult['missions'] = [];
    let skipped = 0;
    let autoAccepted = 0;
    for (const seed of seeds) {
      const goal = seed.title.trim();
      if (!goal || existing.has(goal)) { skipped++; continue; }
      // triage 로 실행모델 분류(발굴 후보 → 어떤 실행모델). seed.tier 우선.
      const triage = await triageGoal({ goal }, deps.classify ? { classify: deps.classify } : {});
      // §12.5 — 부작용 없는(research/business) + research mandate 범위 + arming 이면 HITL 스킵(status=armed).
      const aa = decideAutoAccept(triage.domain, researchMandate, armed);
      // slug 보강 창구 경유 — 영문 kebab id(한글 휴리스틱 id 유출 구멍 봉합·2026-07-14).
      const m = await createMissionWithSlug(db, {
        goal,
        source: 'discovery',
        status: aa.autoAccept ? 'armed' : 'proposed',
        triage: {
          executionModel: triage.executionModel,
          domain: triage.domain,
          tier: seed.tier,
          engine: triage.engine,
          rationale: seed.rationale,
          confidence: triage.confidence,
        },
        ...(deps.now ? { now: deps.now() } : {}),
      }, deps.slugFn ? { slugFn: deps.slugFn } : {});
      if (aa.autoAccept) autoAccepted += 1;
      // 플랜 초안을 미션 아티팩트로 기록(SE2) — 미션 id 로 키잉된 온-디스크 md.
      // 대표가 승인 전 읽을 문서 + 승인 시 SE4 야간러너의 구현 입력. fail-soft.
      // decomposeRoadmap 주입 + internal-roadmap 이면 TOX 멀티페이즈 분해(비용), 아니면 template.
      const draftPath = (deps.draftPathFor ?? proposalDraftPath)(m.id);
      if (draftPath) {
        let planMd: string | null = null;
        if (deps.decomposeRoadmap && seed.source === 'internal-roadmap' && seed.evidence[0]) {
          const roadmapPath = seed.evidence[0];
          const abs = join(deps.repoRoot ?? process.cwd(), roadmapPath);
          if (existsSync(abs)) {
            try {
              planMd = await decomposeRoadmapToPlan(seed, readFileSync(abs, 'utf-8'), roadmapPath, deps.decomposeRoadmap);
            } catch { /* fallback template */ }
          }
        }
        try {
          mkdirSync(dirname(draftPath), { recursive: true });
          writeFileSync(draftPath, (planMd ?? buildPlanDraft(seed)) + '\n');
        } catch { /* 아티팩트 기록 실패는 미션 인입을 막지 않음 */ }
      }
      existing.add(goal);
      ids.push(m.id);
      missions.push({
        id: m.id, goal, model: triage.executionModel, source: 'discovery',
        status: aa.autoAccept ? 'armed' : 'proposed',
        ...(aa.autoAccept ? { autoAcceptReason: aa.reason } : {}),
      });
    }
    return { created: ids.length, skipped, autoAccepted, ids, missions };
  } finally {
    if (ownDb) db.close();
  }
}
