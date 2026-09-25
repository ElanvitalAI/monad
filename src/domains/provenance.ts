// ── 발화/이벤트 provenance 태그 — 누가·언제·어디서 (2026-07-19) ──
//
// 외부 도구(Claude Code/Codex/Gemini)가 던진 발화도, monad 가 스스로 낸 발화도 **같은 태그**
// 를 달아 회상이 "이걸 monad 가 말했나, 외부가 던졌나 · 어느 커밋/브랜치/디렉토리에서"를 구분한다.
// surface_events 의 `refs`(JSON) + `tags`(공백복수) + `ts`(ISO 시간)에 실린다.
//
//   origin  = monad-self | claude-code | codex | gemini | ...
//   gitHash = 발화 시점 HEAD(short) · branch · cwd(작업 디렉토리)

import { runGitCommand } from '../git-fs/runner.js';

export interface Provenance {
  /** monad-self(자기발화) | claude-code | codex | gemini | … */
  origin: string;
  gitHash?: string;
  branch?: string;
  cwd?: string;
  sessionId?: string;
}

/** provenance → surface_events `refs`(JSON 문자열). 구조 조회용. */
export function provenanceRefs(p: Provenance, extra?: Record<string, unknown>): string {
  const o: Record<string, unknown> = { origin: p.origin };
  if (p.gitHash) o.gitHash = p.gitHash;
  if (p.branch) o.branch = p.branch;
  if (p.cwd) o.cwd = p.cwd;
  if (p.sessionId) o.sessionId = p.sessionId;
  return JSON.stringify({ ...o, ...(extra ?? {}) });
}

/** provenance → surface_events `tags`(FTS/grep 필터용). `origin:<origin>` + 짧은 브랜치. */
export function provenanceTags(p: Provenance): string {
  const tags = [`origin:${p.origin}`];
  if (p.branch) tags.push(`branch:${p.branch}`);
  return tags.join(' ');
}

let _selfCache: Provenance | null = null;

/** 실행 중 monad 프로세스의 self provenance(git short-hash/branch/cwd). 1회 계산 후 캐시
 *  (per-turn subprocess 비용 방지). monad 가 자기 발화를 기록할 때 이 태그를 단다. */
export function monadSelfProvenance(): Provenance {
  if (_selfCache) return _selfCache;
  const cwd = process.cwd();
  const git = (args: string[]): string | undefined => {
    try {
      const result = runGitCommand(cwd, args, { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] });
      const out = result.status === 0 ? result.stdout.trim() : '';
      return out || undefined;
    } catch { return undefined; }
  };
  _selfCache = {
    origin: 'monad-self',
    ...(git(['rev-parse', '--short', 'HEAD']) ? { gitHash: git(['rev-parse', '--short', 'HEAD']) } : {}),
    ...(git(['rev-parse', '--abbrev-ref', 'HEAD']) ? { branch: git(['rev-parse', '--abbrev-ref', 'HEAD']) } : {}),
    cwd,
  };
  return _selfCache;
}

/** 테스트 seam — self provenance 캐시 리셋. */
export function _resetSelfProvenanceForTest(): void { _selfCache = null; }
