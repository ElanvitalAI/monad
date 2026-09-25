// ── Self-Evolution SE1 · 참조 repo diff 디거 (외부 발굴 2순위 · 2026-07-09) ──
//
// 대표: "PR을 보고 자율적으로 디깅해 큰 기능 단위로 알아서 생각하라. 2달 트래킹 공백의
// 원래 기능 중 못 따라간 것을 발굴하라." ref-sync 후 마지막 본 SHA→HEAD diff 를 파일
// 영역(top dir)별로 clustering → 큰 기능 단위 흡수 후보. LLM 분석은 seam(주입).
//
// 순수 로직 + 주입 runGit. 상태(마지막 dug SHA)는 호출측이 관리(repo_watch.db 재사용 가능).

import { runGitCommand } from '../../git-fs/runner.js';
import type { RunGit } from './ref-sync.js';

const defaultRunGit: RunGit = (dir, args) => {
  const result = runGitCommand(dir, args, { encoding: 'utf-8', timeout: 60_000 });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
};

export interface RefCommit { sha: string; msg: string; files: string[] }

/** sinceSha..HEAD 커밋 목록(파일 포함). sinceSha 없으면 최근 N개. */
export function digCommits(dir: string, sinceSha: string | null, runGit: RunGit = defaultRunGit, cap = 200): RefCommit[] {
  const range = sinceSha ? `${sinceSha}..HEAD` : `-${cap}`;
  let out: string;
  try {
    // 각 커밋: <sha>\x1f<subject> 다음 줄들에 파일. 커밋 구분 \x1e.
    out = runGit(dir, ['log', range, '--name-only', '--pretty=format:%x1e%H%x1f%s', `-${cap}`]);
  } catch { return []; }
  const commits: RefCommit[] = [];
  for (const block of out.split('\x1e')) {
    const b = block.trim();
    if (!b) continue;
    const nl = b.indexOf('\n');
    const header = nl >= 0 ? b.slice(0, nl) : b;
    const [sha, msg] = header.split('\x1f');
    if (!sha) continue;
    const files = nl >= 0 ? b.slice(nl + 1).split('\n').map(s => s.trim()).filter(Boolean) : [];
    commits.push({ sha, msg: msg ?? '', files });
  }
  return commits;
}

/** 파일 경로 → 기능 영역(top 2 세그먼트·언어 접두 정리). clustering 키. */
export function areaOf(file: string): string {
  const parts = file.split('/').filter(Boolean);
  if (parts.length <= 1) return '(root)';
  // codex-rs/core/src/... → codex-rs/core. src/foo/bar → src/foo.
  return parts.slice(0, 2).join('/');
}

export interface FeatureCluster { area: string; commits: number; files: number; sampleMsgs: string[] }

/** 커밋 → 기능 영역별 클러스터(변경 많은 순). 큰 기능 단위 사고의 기반. */
export function clusterByArea(commits: RefCommit[]): FeatureCluster[] {
  const map = new Map<string, { commits: Set<string>; files: Set<string>; msgs: string[] }>();
  for (const c of commits) {
    const areas = new Set(c.files.map(areaOf));
    for (const area of areas) {
      const g = map.get(area) ?? { commits: new Set(), files: new Set(), msgs: [] };
      g.commits.add(c.sha);
      c.files.filter(f => areaOf(f) === area).forEach(f => g.files.add(f));
      if (g.msgs.length < 5 && c.msg) g.msgs.push(c.msg);
      map.set(area, g);
    }
  }
  return [...map.entries()]
    .map(([area, g]) => ({ area, commits: g.commits.size, files: g.files.size, sampleMsgs: g.msgs }))
    .sort((a, b) => b.commits - a.commits);
}

export interface AbsorptionCandidate {
  repoKey: string;
  area: string;
  commits: number;
  files: number;
  whatChanged: string[];  // sample commit msgs
  score: number;          // 흡수 관심도(활동량 + 키워드)
}

const INTEREST_KW = ['agent', 'loop', 'memory', 'tool', 'plan', 'goal', 'schedul', 'orchestr',
  'reason', 'context', 'retriev', 'recall', 'fork', 'worktree', 'session', 'mcp', 'autonom'];

/** 클러스터 → 흡수 후보(활동량 + 관심 키워드 점수). 큰 기능 단위(commits 많은 영역). */
export function synthesizeCandidates(repoKey: string, clusters: FeatureCluster[], limit = 8): AbsorptionCandidate[] {
  return clusters.map(c => {
    const kwHits = INTEREST_KW.filter(k => c.sampleMsgs.join(' ').toLowerCase().includes(k)).length;
    const score = Math.min(100, c.commits * 4 + c.files + kwHits * 8);
    return { repoKey, area: c.area, commits: c.commits, files: c.files, whatChanged: c.sampleMsgs, score };
  }).sort((a, b) => b.score - a.score).slice(0, limit);
}

/** 흡수 후보 리포트(SE2 제안 입력). */
export function renderAbsorptionReport(repoKey: string, candidates: AbsorptionCandidate[]): string {
  if (!candidates.length) return `# [${repoKey}] 새 변경 없음`;
  const L = [`# [${repoKey}] 흡수 후보 (큰 기능 단위 · 활동/관심순)`, ''];
  L.push('| 영역 | 커밋 | 파일 | 점수 | 무엇이 바뀌었나 |');
  L.push('|---|--:|--:|--:|---|');
  for (const c of candidates) L.push(`| ${c.area} | ${c.commits} | ${c.files} | ${c.score} | ${c.whatChanged.slice(0, 2).join(' / ').slice(0, 80)} |`);
  return L.join('\n');
}
