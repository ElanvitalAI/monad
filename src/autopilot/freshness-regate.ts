// ── 신선도 재게이트 (2차 안전망 · 2026-07-13 · 대표 설계) ────────────────────────
//
// DESIGN-adaptive-resolution-self-healing §5: 게이트 커버리지(#4040·산출 테스트 실행)가 1차 근본이면,
// **진짜 staleness**(빌드 중 main 이 실제로 관련 파일을 바꿈)는 별개 2차 안전망이다. 게이트 통과 후
// done/mergeable 마킹 전에 현재 main HEAD 대비 재검증 → FAIL 이면 stale-base-fail(rebase+rebuild).
//
// ★ sub8 교훈(DESIGN §4.1): "base..main 거리 > 0" 만으로 stale 단정 금지. sub8 은 3커밋 뒤였으나
// 파일이 100% 동일(무관한 커밋)이라 stale 아니었다 — 진짜 근본은 커버리지였다. 그래서 신선도는
// **거리가 아니라 파일 겹침**으로 판정한다: main 이 이 페이즈 산출물과 겹치는 파일을 바꿨을 때만 stale.

import { runGitCommand } from '../git-fs/runner.js';

export interface FreshnessVerdict {
  /** true = base 가 main 대비 신선(재게이트 통과). false = stale-base(rebase+rebuild 필요). */
  fresh: boolean;
  baseSha: string;
  mainSha: string;
  /** base..main 커밋 거리(관측·진단 노출용). 거리>0 자체는 stale 아님. */
  distance: number;
  /** main 이 바꾼, 이 페이즈 산출물과 겹치는 파일(겹침>0 일 때만 stale). */
  staleFiles: string[];
  reason: string;
}

/** base/main SHA + main 이 바꾼 파일 + 페이즈가 만진 파일 → 신선도 판정. 순수·결정론.
 *  ★ 파일 겹침 기준(sub8 교훈): 거리>0 이어도 겹치는 파일이 없으면 신선(무관한 커밋). */
export function judgeFreshness(input: {
  baseSha: string;
  mainSha: string;
  distance: number;
  mainChangedFiles: readonly string[];
  phaseFiles: readonly string[];
}): FreshnessVerdict {
  const base = { baseSha: input.baseSha, mainSha: input.mainSha, distance: input.distance };
  if (input.baseSha === input.mainSha || input.distance <= 0) {
    return { ...base, fresh: true, staleFiles: [], reason: 'base == main HEAD(거리 0) — 최신.' };
  }
  const phaseSet = new Set(input.phaseFiles);
  const staleFiles = [...new Set(input.mainChangedFiles)].filter((f) => phaseSet.has(f));
  if (staleFiles.length === 0) {
    return {
      ...base, fresh: true, staleFiles: [],
      reason: `base..main 거리 ${input.distance} 이나 겹치는 파일 0 — 신선(무관한 커밋·거리만으로 stale 단정 금지·sub8 교훈).`,
    };
  }
  return {
    ...base, fresh: false, staleFiles,
    reason: `main 이 페이즈 산출물과 겹치는 ${staleFiles.length}개 파일 변경(거리 ${input.distance}) — stale-base. rebase-onto-main + rebuild 필요.`,
  };
}

/** 신선도 조회 seam(git). 테스트는 주입, 기본은 실 git(origin/main). */
export interface FreshnessGit {
  /** origin/main HEAD SHA. */
  mainSha(): string;
  /** baseSha..origin/main 커밋 수. */
  distance(baseSha: string): number;
  /** git diff --name-only baseSha..origin/main. */
  mainChangedFiles(baseSha: string): string[];
}

/** 신선도 재게이트 — baseSha + 페이즈 산출 파일을 현재 origin/main 대비 재검증. git seam 주입 가능
 *  (테스트/재사용). 기본 seam 은 실 git(origin/main·fetch 선행 권장). */
export function regateFreshness(input: {
  baseSha: string;
  phaseFiles: readonly string[];
  git?: FreshnessGit;
}): FreshnessVerdict {
  const git = input.git ?? defaultFreshnessGit();
  const mainSha = git.mainSha();
  const distance = git.distance(input.baseSha);
  const mainChangedFiles = git.mainChangedFiles(input.baseSha);
  return judgeFreshness({ baseSha: input.baseSha, mainSha, distance, mainChangedFiles, phaseFiles: input.phaseFiles });
}

function git(args: string[], repoRoot?: string): string {
  const result = runGitCommand(repoRoot ?? process.cwd(), args, {
    encoding: 'utf-8', timeout: 20_000, maxBuffer: 8 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

/** 기본 git seam — origin/main 기준. fetchFirst=true 면 조회 전 origin main 를 fetch(stale ref 오판
 *  방지·reconcile gotcha 동형). fail-soft(빈 결과 시 신선 판정 쪽으로 기움). */
export function defaultFreshnessGit(opts: { repoRoot?: string; fetchFirst?: boolean } = {}): FreshnessGit {
  const root = opts.repoRoot;
  if (opts.fetchFirst) { try { git(['fetch', 'origin', 'main', '--quiet'], root); } catch { /* fail-soft */ } }
  return {
    mainSha: () => git(['rev-parse', 'origin/main'], root),
    distance: (baseSha: string) => {
      const n = git(['rev-list', '--count', `${baseSha}..origin/main`], root);
      return /^\d+$/.test(n) ? Number(n) : 0;
    },
    mainChangedFiles: (baseSha: string) => {
      const out = git(['diff', '--name-only', `${baseSha}..origin/main`], root);
      return out ? out.split('\n').map((s) => s.trim()).filter(Boolean) : [];
    },
  };
}

/** 현재 작업 브랜치의 base(merge-base HEAD origin/main) + 변경 파일 자동 산출 → 재게이트. CLI 편의
 *  ("내 브랜치가 main 대비 stale 한가"). base/files 명시하면 그걸 사용. */
export function regateCurrentBranch(opts: { repoRoot?: string; baseSha?: string; phaseFiles?: string[]; fetchFirst?: boolean } = {}): FreshnessVerdict {
  const root = opts.repoRoot;
  if (opts.fetchFirst) { try { git(['fetch', 'origin', 'main', '--quiet'], root); } catch { /* */ } }
  const baseSha = opts.baseSha || git(['merge-base', 'HEAD', 'origin/main'], root);
  const phaseFiles = opts.phaseFiles ?? (() => {
    const out = git(['diff', '--name-only', `${baseSha}..HEAD`], root);
    return out ? out.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  })();
  return regateFreshness({ baseSha, phaseFiles, git: defaultFreshnessGit(root ? { repoRoot: root } : {}) });
}
