// ── PR -> revise 정정 context (대표 2026-07-16) ────────────────────────────
//
// 대표 요구: "PR 도 알아서 분해할 수 있게끔". revise/revise-suggest 에 PR 번호를 던지면 시스템이
// 스스로 그 PR 내용(제목·본문·변경 코드파일 목록·연관 RFC/PLAN 문서 발췌)을 읽어 정정 context 로
// 합류한다 — 사람이 PR 요지를 손으로 요약해 넣지 않아도 된다. 이 context 가 recommendRevise 의
// userContext(1차 정정 동인)로 들어가 LLM 이 골 재분해 지시(comment)를 생성한다.
//
// gh/파일 IO 는 seam(테스트 순수). fail-soft — 부분 실패(gh 미인증·문서 부재)는 스킵, 막지 않음.
// 패턴: mission-landing-scan(execSync gh) + gatherReviseObservation(디스크 관측) 동형.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

export interface PrInfo {
  number: number;
  title: string;
  body: string;
  files: string[];   // 변경 파일 경로
}

export interface PrContextDeps {
  /** PR 번호 -> 정보(gh pr view). 미주입 시 기본 gh IO. 실패=null. */
  ghView?: (pr: number) => PrInfo | null;
  /** 문서 경로 -> 발췌(레포 파일). 미주입 시 기본 파일 IO. 없으면 null. */
  readDoc?: (path: string) => string | null;
}

const DOC_REF_RE = /docs\/[^\s)'"`\]]+\.md/gi;   // body 에 언급된 문서 경로
const DOC_FILE_RE = /\.md$/i;
const DOC_KIND_RE = /RFC|PLAN|REPORT|RESEARCH|DESIGN|HANDOFF/i;

/** PR 변경파일(문서) + body 언급 내부 문서 `*` 후보 추출. 중복 제거·순수. */
export function extractDocPaths(prs: PrInfo[]): string[] {
  const set = new Set<string>();
  for (const pr of prs) {
    for (const f of pr.files) if (DOC_FILE_RE.test(f) && DOC_KIND_RE.test(f)) set.add(f);
    for (const m of (pr.body ?? '').matchAll(DOC_REF_RE)) set.add(m[0]);
  }
  return [...set];
}

/** PR 정보 목록 + 문서 발췌 -> revise 정정 context 문자열(순수·테스트). */
export function buildPrContextString(prs: PrInfo[], docExcerpts: Record<string, string>): string {
  const L: string[] = [];
  L.push('아래 PR 의 변경 내용을 반영해 이 미션 골을 재분해(정정)하라. PR 이 도입/설계한 역할·경계를');
  L.push('미션이 소비/구현하도록 골과 페이즈를 조정한다(중복 재구현 금지·PR 산출물 재사용).');
  L.push('');
  for (const pr of prs) {
    L.push(`PR #${pr.number}: ${pr.title}`);
    const body = (pr.body ?? '').replace(/\r/g, '').trim();
    if (body) L.push(body.slice(0, 1200));
    const codeFiles = pr.files.filter((f) => !DOC_FILE_RE.test(f));
    if (codeFiles.length) L.push(`변경 코드파일(${codeFiles.length}): ${codeFiles.slice(0, 24).join(', ')}`);
    L.push('');
  }
  for (const [path, excerpt] of Object.entries(docExcerpts)) {
    if (excerpt.trim()) {
      L.push(`연관 설계문서 ${path}:`);
      L.push(excerpt.slice(0, 1600));
      L.push('');
    }
  }
  return L.join('\n').trim();
}

/** PR 번호들 -> revise 정정 context. gh/파일 IO seam. fail-soft(부분 실패 스킵·빈 문자열 가능). */
export function fetchPrContext(prNumbers: number[], deps: PrContextDeps = {}): string {
  const ghView = deps.ghView ?? defaultGhView;
  const readDoc = deps.readDoc ?? defaultReadDoc;
  const prs: PrInfo[] = [];
  for (const n of prNumbers) {
    try { const info = ghView(n); if (info) prs.push(info); } catch { /* skip */ }
  }
  if (!prs.length) return '';
  const docExcerpts: Record<string, string> = {};
  for (const path of extractDocPaths(prs).slice(0, 4)) {
    try { const ex = readDoc(path); if (ex) docExcerpts[path] = ex; } catch { /* skip */ }
  }
  return buildPrContextString(prs, docExcerpts);
}

/** "4307" | "4306,4307" | 4307 -> [4306, 4307]. 무효 토큰 제외·순수. */
export function parsePrArg(pr: unknown): number[] {
  if (pr == null) return [];
  const raw = String(pr).trim();
  if (!raw) return [];
  return raw.split(/[,\s]+/).map((t) => Number(t.replace(/^#/, '').trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

function defaultGhView(pr: number): PrInfo | null {
  try {
    const out = execSync(`gh pr view ${pr} --json number,title,body,files`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 15000,
    });
    const j = JSON.parse(out) as { number: number; title?: string; body?: string; files?: { path: string }[] };
    return { number: j.number, title: j.title ?? '', body: j.body ?? '', files: (j.files ?? []).map((f) => f.path) };
  } catch { return null; }
}

function defaultReadDoc(path: string): string | null {
  try { return existsSync(path) ? readFileSync(path, 'utf8').slice(0, 4000) : null; } catch { return null; }
}
