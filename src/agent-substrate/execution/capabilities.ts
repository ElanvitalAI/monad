// ── L2 실행 capability 카탈로그 (조합형 cross-cutting) ──
//
// PLAN §6b·§6e·§L2. 롤/executor 가 capability 를 **조합**한다(조합깊이 = 무게: agent-mission 경량·
// self-implement 중간·미션 패브릭 최대). 어떤 capability 는 이미 공유(generic·재사용), 어떤 것은 미션
// 고유(→ 공유 L2 로 승격 target). enhance 만 진입 민감(mode-gated)·나머지 memory/observe 등은 진입 무관(§6e).
//
// P2-seed: **카탈로그 + 조합 descriptor + 승격 target**(비파괴·additive). roles.ts(P1-seed)와 짝.
// 실제 조합 배선(각 executor 가 이 목록대로 capability 를 실제 조립)은 후속 마이그레이션.

export type CapabilityId =
  // 공유 기본(전/다수 조합이 공유)
  | 'pty-substrate' | 'goal-loop' | 'enhance' | 'coverage' | 'memory' | 'observe'
  // 미션 고유(현재 autopilot 소유 → 공유 L2 승격 target)
  | 'isolation' | 'budget' | 'arming' | 'frame-journal' | 'lineage' | 'critique-grounding'
  | 'materialize' | 'decision';

/** 진입 민감도(§6e) — sensitive=mode-gated(누구 지능이 프롬프트 짜나) / independent=진입 무관(항상). */
export type EntrySensitivity = 'sensitive' | 'independent';

export interface CapabilityDescriptor {
  id: CapabilityId;
  /** 현재 소유/구현 위치. */
  owner: string;
  /** 이미 공유(generic·재사용 가능) vs 미션 고유(공유 L2 로 승격 target = shared:false). */
  shared: boolean;
  /** 진입 민감도(§6e). enhance 만 sensitive. */
  entry: EntrySensitivity;
  note: string;
}

export const CAPABILITY_CATALOG: readonly CapabilityDescriptor[] = [
  { id: 'pty-substrate', owner: 'src/pty-shell/registry.ts', shared: true, entry: 'independent', note: 'L0 spawn·capture·연속포워딩·입력·id/닉네임/accessMode' },
  { id: 'goal-loop', owner: 'src/self-implement + agent-mission brain', shared: false, entry: 'independent', note: 'iterate-until-evidence(단일 모듈로 분리 target)' },
  { id: 'enhance', owner: 'src/agent-substrate/execution/ingestion-policy + prompt-enhance', shared: true, entry: 'sensitive', note: 'mode-gated(elanous-apparatus ON/external-verbatim OFF)·verbatim 보존+가산' },
  { id: 'coverage', owner: 'src/prompt-enhance/coverage.ts', shared: true, entry: 'independent', note: '산출이 요구 체크리스트를 담았는지 검증' },
  { id: 'memory', owner: 'src/agent-substrate/execution/memory-context.ts', shared: true, entry: 'independent', note: '항상 ON·가산 grounding·프롬프트 무접촉(mirage 가드)' },
  { id: 'observe', owner: 'logs.db + registry 버스(onPtyEvent)', shared: true, entry: 'independent', note: '항상 ON·공유 버스 버블(제1원칙)' },
  { id: 'isolation', owner: 'src/autopilot/build/isolated-instance.ts', shared: false, entry: 'independent', note: 'config-dir/worktree/.elanous-se·deterministic port·assertIsolationSafe' },
  { id: 'budget', owner: 'src/autopilot/mission-budget.ts', shared: false, entry: 'independent', note: 'SE/Walker 사다리·token→turn tighten·stop point' },
  { id: 'arming', owner: 'src/autopilot/arming.ts + mission-arming-gate.ts', shared: false, entry: 'independent', note: 'fail-closed DISARMED·per-phase HITL 카드·materialize-mandate' },
  { id: 'frame-journal', owner: 'src/autopilot/pipeline/frame-* over src/agent-substrate/frames.ts', shared: true, entry: 'independent', note: '불변 append JSONL·replay/rewind/goto/rerun·pending-write' },
  { id: 'lineage', owner: 'src/autopilot/lineage/historian.ts', shared: false, entry: 'independent', note: 'apm_id 귀속·6-source timeline·cold-ledger·generation' },
  { id: 'critique-grounding', owner: 'src/autopilot/mission-critique + mission-grounding-ladder', shared: false, entry: 'independent', note: 'code+skill+doc+external 그라운딩·decision reuse(pr-reviewer 는 이미 공유)' },
  { id: 'materialize', owner: 'src/autopilot/mission-engine.ts', shared: false, entry: 'independent', note: 'cron 크론화·approveMission·dispatchScheduleManage' },
  { id: 'decision', owner: 'src/autopilot/mission-decision.ts', shared: false, entry: 'independent', note: '결정=데이터·working-memory 주입·재사용' },
];

/** 조합 종류(무게) — PLAN §6b. */
export type CompositionKind = 'agent-mission' | 'self-implement' | 'skill' | 'mission-fabric';

/** 전 조합 공통(entry-independent 기본) — substrate·기억·관측은 어떤 진입이든(§6e). */
const BASE: readonly CapabilityId[] = ['pty-substrate', 'memory', 'observe'];

/** ★ 조합별 기본 capability 세트(조합깊이 = 무게). 미션 패브릭 = 최대 조합. */
export function capabilitiesForComposition(kind: CompositionKind): CapabilityId[] {
  switch (kind) {
    case 'agent-mission': return [...BASE, 'enhance', 'coverage'];
    case 'skill': return [...BASE, 'enhance', 'coverage'];
    case 'self-implement': return [...BASE, 'goal-loop', 'enhance', 'coverage', 'isolation', 'budget'];
    case 'mission-fabric': return [
      ...BASE, 'goal-loop', 'enhance', 'coverage',
      'isolation', 'budget', 'arming', 'frame-journal', 'lineage', 'critique-grounding', 'materialize', 'decision',
    ];
  }
}

/** 미션 고유(아직 shared:false) → 공유 L2 승격 target 목록. 통합 시 이들을 재사용 모듈로. */
export function promotionTargets(): CapabilityId[] {
  return CAPABILITY_CATALOG.filter((c) => !c.shared).map((c) => c.id);
}

/** id → descriptor 조회(없으면 undefined). */
export function capability(id: CapabilityId): CapabilityDescriptor | undefined {
  return CAPABILITY_CATALOG.find((c) => c.id === id);
}

// ── capability 활성화 (선언 → 실제 behavior 구동) ──
//
// P2-seed 는 조합별 capability 를 **선언**만 했다(descriptor). 이 리졸버가 그 선언을 §6e 진입 정책과 합성해
// **어떤 capability 가 실제 ON 인지**를 낸다 = "선언이 behavior 를 구동"의 SSOT. 첫 소비자=generic-skill-executor.
//   - enhance = 진입 민감(mode-gated): 선언에 있어도 ingestion 정책(elanous-apparatus ON/external-verbatim OFF·
//     explicit override)이 최종 결정.
//   - 나머지(memory·observe·coverage·…) = 진입 무관: 선언에 있으면 ON(§6e).

import { resolveIngestionPolicy, type IngestionEntry } from './ingestion-policy.js';

export interface CapabilityActivation {
  /** 실제 활성 capability 집합(선언 ∩ 정책). */
  active: ReadonlySet<CapabilityId>;
  has(id: CapabilityId): boolean;
}

export interface ResolveActiveOpts {
  /** 진입 클래스(§6e) — enhance mode-gating 에 사용. 기본 elanous-apparatus. */
  entry?: IngestionEntry;
  /** 호출자 명시 enhance(정책 기본값보다 우선). */
  explicitEnhance?: boolean;
}

/**
 * ★ 조합 kind 의 선언 capability 를 진입 정책과 합성해 **활성 집합**을 낸다.
 *   enhance 만 entry-sensitive(정책이 최종 게이트) · 나머지는 선언 그대로(entry-independent·§6e).
 *   generic-skill-executor 등 소비자가 이걸로 enhance/memory 등을 게이트 = descriptor 가 살아있는 behavior 로.
 */
export function resolveActiveCapabilities(kind: CompositionKind, opts: ResolveActiveOpts = {}): CapabilityActivation {
  const declared = new Set<CapabilityId>(capabilitiesForComposition(kind));
  // enhance = 진입 민감: 선언돼 있어도 정책이 OFF 면 비활성(external-verbatim·명시 off).
  if (declared.has('enhance')) {
    const policy = resolveIngestionPolicy({
      entry: opts.entry ?? 'elanous-apparatus',
      ...(opts.explicitEnhance !== undefined ? { explicitEnhance: opts.explicitEnhance } : {}),
    });
    if (!policy.enhance) declared.delete('enhance');
  }
  return { active: declared, has: (id) => declared.has(id) };
}
