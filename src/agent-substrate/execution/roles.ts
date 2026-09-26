// ── 실행 롤 (Docker 메타포 — 같은 elanous, env 로 롤 결정) ──
//
// PLAN(§1·§L1) — 같은 elanous 이미지가 env/config 로 롤을 바꾼다: controller(brain·다른 PTY 구동) /
// executor(일 수행: self·agent·skill) / orchestrator(팬아웃·파이프라인). 자기 자신을 멀티롤·재귀 중첩.
//
// P1-seed: **타입 + env 해석 + 기존 harness→롤 매핑 descriptor**(마이그레이션 target). 실제 executor
// 마이그레이션은 후속(비파괴 토대만 — 지금은 이 타입을 소비하는 코드 없음. 통합의 뼈대를 먼저 세운다).

export type ExecutionRole = 'controller' | 'executor' | 'orchestrator';
export type ExecutorKind = 'self' | 'agent' | 'skill';

export interface RoleConfig {
  role: ExecutionRole;
  /** role==='executor' 일 때 executor 종류. */
  executorKind?: ExecutorKind;
  /** executorKind==='agent' 일 때 backend(codex·claude·gemini·grok). */
  agentBackend?: string;
}

const ROLES: readonly ExecutionRole[] = ['controller', 'executor', 'orchestrator'];
const KINDS: readonly ExecutorKind[] = ['self', 'agent', 'skill'];

/** 롤 정규화 — 미지정/부적합 → 'executor'(가장 흔한 기본). */
export function normalizeRole(v?: string): ExecutionRole {
  return ROLES.includes(v as ExecutionRole) ? (v as ExecutionRole) : 'executor';
}
/** executor 종류 정규화 — 미지정/부적합 → 'self'. */
export function normalizeExecutorKind(v?: string): ExecutorKind {
  return KINDS.includes(v as ExecutorKind) ? (v as ExecutorKind) : 'self';
}

/**
 * ★ env 로 롤 해석(Docker 개념 — 같은 이미지·env 만 다름).
 *   ELANOUS_ROLE(controller|executor|orchestrator·기본 executor) · ELANOUS_EXECUTOR_KIND(self|agent|skill) ·
 *   ELANOUS_AGENT_BACKEND(agent kind 일 때 codex 등). 미지정 = executor:self.
 */
export function resolveRoleFromEnv(env: Record<string, string | undefined> = process.env): RoleConfig {
  const role = normalizeRole(env.ELANOUS_ROLE);
  if (role !== 'executor') return { role };
  const executorKind = normalizeExecutorKind(env.ELANOUS_EXECUTOR_KIND);
  const cfg: RoleConfig = { role, executorKind };
  if (executorKind === 'agent' && env.ELANOUS_AGENT_BACKEND) cfg.agentBackend = env.ELANOUS_AGENT_BACKEND;
  return cfg;
}

/** 롤 요약 문자열(관측·로그용). 예: 'executor:agent(codex)'·'orchestrator'. */
export function describeRole(cfg: RoleConfig): string {
  if (cfg.role !== 'executor') return cfg.role;
  const k = cfg.executorKind ?? 'self';
  return k === 'agent' && cfg.agentBackend ? `executor:agent(${cfg.agentBackend})` : `executor:${k}`;
}

/** 기존 harness → 롤 매핑(통합 target·문서화). 3 harness + 미션패브릭 orchestrator 가 한 엔진의 롤로 흡수. */
export interface HarnessRoleDescriptor {
  harness: string;
  role: ExecutionRole;
  executorKind?: ExecutorKind;
  module: string;
  note: string;
}
export const HARNESS_ROLE_MAP: readonly HarnessRoleDescriptor[] = [
  {
    harness: 'self-implement', role: 'executor', executorKind: 'self',
    module: 'src/self-implement/orchestrator.ts', note: 'elanous 자기 goal-loop(rework·gate·escalate)',
  },
  {
    harness: 'agent-mission', role: 'controller',
    module: 'src/agent-mission/driver.ts', note: 'brain 이 외부 agent(codex/claude/…) PTY 를 몰다 = controller + executor:agent',
  },
  {
    harness: 'generic-skill-executor', role: 'executor', executorKind: 'skill',
    module: 'src/harness/generic-skill-executor.ts', note: 'luna 발견→스킬 체인(P3 흡수·capability-driven 첫 소비자: enhance/memory 를 resolveActiveCapabilities 로 구동)',
  },
  {
    harness: 'staged-harness', role: 'orchestrator',
    module: 'src/harness/staged-harness.ts', note: 'P→E→R→D 파이프라인·어느 executor 든 감쌈·미션 패브릭이 최대 조합으로 소비',
  },
];
