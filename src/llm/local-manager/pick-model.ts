// ── 로컬 모델 정책 auto-pick (대표 확정 fleet 정책 · 2026-07-15) ────────────────
//
// inventory(getInventory)에서 fleet 정책에 맞는 로컬 모델을 스스로 고른다. 종전엔 자동 pick 이 없어
// 사용자/config 핀에 의존했다(semantic-supersede 의 pickLocalChatModel 은 gemma 전용 특수 로직).
//
// 정책(대표 2026-07-15 · MANUAL-llm-model-management SSoT):
//   런타임 **MLX 우선** · **Q4 양자화 선호** · **스피드 우선**(빠른 MoE 예 gemma-4 35B MoE) ·
//   노드 RAM 예산(M3 Ultra 512GB 대형 허용 · **M5 Max 128GB 멀티잡 ≤30GB/모델**).
// 순수·주입(inventory) — 테스트/미션이 재사용.

import type { LlmInventory, LlmModel, LlmRuntime } from './types.js';

export interface LocalFleetPolicy {
  /** 런타임 우선순위(앞이 높음) — MLX(Apple Silicon 최속) 우선. */
  runtimePriority: readonly LlmRuntime[];
  /** 양자화 선호 힌트(id/label 소문자 포함 매칭). Q4 우선. */
  preferQuantHints: readonly string[];
  /** 스피드 힌트(MoE 활성파라미터 표기 등) — 있으면 빠른 것으로 가점. */
  speedHints: readonly string[];
  /** 노드별 모델 크기 상한(bytes). M5 Max 노드 → 30GB 등. 미지정 노드=defaultNodeBudgetBytes. */
  nodeBudgetBytes?: Readonly<Record<string, number>>;
  /** 노드 예산 기본값(bytes). undefined=무제한(fit 필터 안 함). */
  defaultNodeBudgetBytes?: number;
  /** 후보 제외(임베딩 등). */
  excludeIdRe?: RegExp;
}

export const GiB = 1024 ** 3;

/** 대표 확정 기본 정책 — MLX>lmstudio>ollama>docker · Q4 · MoE 스피드 · 임베딩 제외. 노드 예산은
 *  config/실측으로 주입(M5 Max ≤30GB). 기본은 무제한(예산 미지정 시 크기 fit 필터 안 함). */
export const DEFAULT_LOCAL_FLEET_POLICY: LocalFleetPolicy = {
  runtimePriority: ['mlx', 'lmstudio', 'ollama', 'docker'],
  preferQuantHints: ['q4', '4bit', '4-bit', 'q4_k', 'iq4', '4b-it'],
  speedHints: ['moe', 'a3b', 'a4b', 'a2b'], // 활성 파라미터 표기 = MoE(빠름)
  excludeIdRe: /embed|nomic|bge|e5-|gte-/i,
};

export interface PickLocalOpts {
  policy?: LocalFleetPolicy;
  /** 추가 필터(예: 챗만·vision만). */
  predicate?: (m: LlmModel) => boolean;
}

/** 후보 모델 정책 점수 — 높을수록 선호. 순수. */
export function scoreLocalModel(m: LlmModel, policy: LocalFleetPolicy): number {
  const idl = `${m.id} ${m.label}`.toLowerCase();
  const rtIdx = policy.runtimePriority.indexOf(m.runtime);
  const rtScore = rtIdx < 0 ? 0 : (policy.runtimePriority.length - rtIdx) * 100; // MLX 최상위
  const fmtMlx = m.format === 'mlx' ? 30 : 0;
  const quant = policy.preferQuantHints.some((h) => idl.includes(h)) ? 40 : 0;
  const speed = policy.speedHints.some((h) => idl.includes(h)) ? 25 : 0; // MoE 등
  const loaded = m.loaded ? 10 : 0;
  return rtScore + fmtMlx + quant + speed + loaded;
}

/**
 * 정책 auto-pick — reachable 노드에서 예산 적합 후보 중 최고 점수(동점=작은 크기·빠름). null=후보 없음.
 */
export function pickLocalModel(inv: LlmInventory, opts: PickLocalOpts = {}): LlmModel | null {
  const policy = opts.policy ?? DEFAULT_LOCAL_FLEET_POLICY;
  const reachable = new Set(inv.nodes.filter((n) => n.reachable).map((n) => n.id));
  const budgetOf = (nodeId: string): number | undefined =>
    policy.nodeBudgetBytes?.[nodeId] ?? policy.defaultNodeBudgetBytes;
  const cands = inv.models.filter((m) => {
    if (!reachable.has(m.nodeId)) return false;
    if (policy.excludeIdRe?.test(m.id)) return false;
    if (opts.predicate && !opts.predicate(m)) return false;
    const b = budgetOf(m.nodeId);
    if (b !== undefined && m.sizeBytes !== undefined && m.sizeBytes > b) return false; // RAM 예산 초과(M5 Max ≤30GB)
    return true;
  });
  if (!cands.length) return null;
  return [...cands].sort(
    (a, b) => scoreLocalModel(b, policy) - scoreLocalModel(a, policy)
      || (a.sizeBytes ?? Infinity) - (b.sizeBytes ?? Infinity), // 스피드 우선: 동점이면 작은 것
  )[0]!;
}
