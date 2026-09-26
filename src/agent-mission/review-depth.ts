// ── 2계층 리뷰 무게 판정 — light(1차 충분) / heavy(2차 Opus 심판 머스트) (2026-07-23) ──
//
// ROADMAP-elanous-is-all §2b(무인레벨 삼각). 대표 co-design: 리뷰어를 계층화한다.
//   1차 리뷰어(reviewPullRequest·LGTM/approve) · 2차 리뷰어(ACP Opus 최종심판·acp-judge).
// 작업 무게로 경계를 가른다:
//   - **소작업(light)**: 1차 리뷰어 + tsc 게이트로 충분 → clean 이면 approve+자동머지(2차 생략).
//   - **헤비(heavy)**: 반드시 2차 리뷰어(ACP Opus)까지 태운다(3층 독립 유지).
// 판정은 순수(diff 통계 + config 임계). 기본 보수적 — 모호/미상이면 heavy.

export type ReviewDepth = 'light' | 'heavy';

/** 핵심 경로 기본값 — 이 경로 변경은 시스템 코어라 heavy(2차 심판 머스트). config.corePaths 로 override. */
export const DEFAULT_CORE_PATHS: readonly string[] = [
  'src/self-implement/', 'src/agent-mission/', 'src/task-orchestrator/',
  'src/harness/', 'src/self-dev/', 'src/boot/', 'src/nexus/',
  'src/agent-substrate/', 'src/user-config', 'src/index.ts',
];

/** 계획문서 패턴 — PLAN/RFC/ROADMAP/마일스톤/DESIGN 등 **방향을 정하는 문서**. 변경 시 heavy(2차 심판 머스트).
 *  코드가 아니라도 방향 결정이라 소작업 취급 금지(대표 지시 2026-07-23). config.planDocPatterns 로 override. */
export const DEFAULT_PLAN_DOC_PATTERNS: readonly RegExp[] = [
  /(^|\/)(ROADMAP|PLAN|RFC|MILESTONE|DESIGN|HANDOFF)[-_]/i, // ROADMAP-·PLAN-·RFC-·MILESTONE-·DESIGN-·HANDOFF-
  /(^|\/)docs\/(plans|rfcs?|roadmaps?|designs?|milestones?)\//i, // docs/plans/·docs/rfc/ 등
];

export interface ReviewDepthConfig {
  maxLightFiles?: number;
  maxLightLines?: number;
  corePaths?: readonly string[];
  /** 계획문서 패턴 override(문자열 정규식). 기본=DEFAULT_PLAN_DOC_PATTERNS. */
  planDocPatterns?: readonly string[];
}

export interface ReviewDepthInput {
  /** 변경 파일 경로(repo-relative). 빈 배열=미상→보수적 heavy. */
  changedFiles: readonly string[];
  additions: number;
  deletions: number;
}

export interface ReviewDepthResult {
  depth: ReviewDepth;
  /** heavy 사유(관측·설명). light 면 빈 배열. */
  reasons: string[];
}

/** 작업 무게 판정 — 파일 수·diff 라인·핵심 경로 중 하나라도 임계 초과면 heavy. 미상=heavy(보수적). */
export function assessReviewDepth(input: ReviewDepthInput, cfg: ReviewDepthConfig = {}): ReviewDepthResult {
  const maxFiles = cfg.maxLightFiles ?? 5;
  const maxLines = cfg.maxLightLines ?? 200;
  const corePaths = cfg.corePaths ?? DEFAULT_CORE_PATHS;

  if (input.changedFiles.length === 0) {
    return { depth: 'heavy', reasons: ['변경 파일 미상 — 보수적 heavy(2차 심판)'] };
  }
  const planPatterns = cfg.planDocPatterns ? cfg.planDocPatterns.map((p) => new RegExp(p, 'i')) : DEFAULT_PLAN_DOC_PATTERNS;

  const reasons: string[] = [];
  if (input.changedFiles.length > maxFiles) reasons.push(`변경 파일 ${input.changedFiles.length} > ${maxFiles}`);
  const lines = Math.max(0, input.additions) + Math.max(0, input.deletions);
  if (lines > maxLines) reasons.push(`diff ${lines}줄 > ${maxLines}`);
  const core = input.changedFiles.filter((f) => corePaths.some((p) => f.startsWith(p) || f.includes(p)));
  if (core.length > 0) reasons.push(`핵심 경로 변경(${core.length}): ${core.slice(0, 3).join(', ')}`);
  // ★ 계획문서(방향 결정) 변경 → heavy(2차 심판 머스트). 코드가 아니라도 방향을 정하므로 소작업 취급 금지.
  const planDocs = input.changedFiles.filter((f) => planPatterns.some((p) => p.test(f)));
  if (planDocs.length > 0) reasons.push(`계획문서 변경(방향 결정·${planDocs.length}): ${planDocs.slice(0, 3).join(', ')}`);

  return { depth: reasons.length > 0 ? 'heavy' : 'light', reasons };
}

/** `gh pr view --json files` (또는 diff --numstat) → ReviewDepthInput. 순수 파싱. */
export function parseReviewDepthFromFilesJson(json: string): ReviewDepthInput {
  try {
    const j = JSON.parse(json) as { files?: Array<{ path?: string; additions?: number; deletions?: number }> };
    const files = j.files ?? [];
    return {
      changedFiles: files.map((f) => f.path ?? '').filter(Boolean),
      additions: files.reduce((s, f) => s + (f.additions ?? 0), 0),
      deletions: files.reduce((s, f) => s + (f.deletions ?? 0), 0),
    };
  } catch {
    return { changedFiles: [], additions: 0, deletions: 0 };
  }
}
