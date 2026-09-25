#!/usr/bin/env bun
/**
 * 커밋 «제목»이 「§N 갱신」이라 주장한 절을 그 커밋의 diff 가 실제로 만졌나.
 *
 * 🩸 계기(2026-09-01 · 142차): `#14904` 의 제목이 "§0·§2·§6 갱신" 이었고 본문이 §0 을 두 번 더
 *    주장했는데, hunk 는 §2·§6 만 건드렸다. 그래서 인계문 §0 이 다음 창을 «이미 닫힌 문제»로 보냈다.
 *    ⇒ 커밋 메시지는 «의도»를 적는 자리인데 그것을 «검증»으로 쓰면 이 사고가 난다.
 *
 * ⛔ 이 자가 «보는 축»은 하나다 — 제목에서 편집 동사(갱신·수정·추가·개정·보강·고침)에 붙은 §N.
 *    본문에서 «참조»로 언급된 §N 은 «주장이 아니다»(그것까지 세면 위양성이 폭발한다 — 실측했다).
 *    ⇒ 「경로를 이름 댔는데 안 만졌다」는 «다른 축»이고 이 자는 그것을 못 본다.
 *
 * ⛔ 판정 보류(=적발 안 함): 바뀐 .md 가 여럿(어느 문서의 §인지 못 잇는다) · 그 §이 그 문서에 없다(남의 문서).
 *
 * 사용:
 *   bun scripts/commit-claim-audit.ts --self-check         # ⭐ 알려진 양성·음성으로 «자를» 먼저 건다
 *   bun scripts/commit-claim-audit.ts --since '1 day ago'  # 전수
 *   bun scripts/commit-claim-audit.ts <sha> [<sha>…]       # 지목
 */
import { execFileSync } from 'node:child_process';

const EDIT_CLAIM = /((?:§\s*\d+[a-z]?[·,\s]*)+)\s*(?:을|를|은|는)?\s*(?:갱신|수정|추가|개정|보강|고침)/;
const SECTION = /§\s*(\d+[a-z]?)/g;
const HEADING = /^#{2,3}\s*§\s*(\d+[a-z]?)/;
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

function git(args: readonly string[]): string {
  try {
    return execFileSync('git', [...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return '';
  }
}

type Span = readonly [number, number];

/** 커밋 «후» 이미지에서 절 → 줄 범위. 뒤 절의 시작 직전까지가 그 절이다. */
function sectionRanges(sha: string, path: string): Map<string, Span> {
  const heads: Array<[string, number]> = [];
  git(['show', `${sha}:${path}`]).split('\n').forEach((line, index) => {
    const m = HEADING.exec(line);
    if (m) heads.push([m[1]!, index + 1]);
  });
  const out = new Map<string, Span>();
  heads.forEach(([name, start], k) => {
    out.set(name, [start, k + 1 < heads.length ? heads[k + 1]![1] - 1 : Number.MAX_SAFE_INTEGER]);
  });
  return out;
}

/** 그 커밋이 그 파일에서 만진 «후 이미지» 줄들. -U0 라 맥락줄이 섞이지 않는다. */
function touchedSpans(sha: string, path: string): Span[] {
  const spans: Span[] = [];
  for (const line of git(['show', sha, '--format=', '-U0', '--', path]).split('\n')) {
    const m = HUNK.exec(line);
    if (!m) continue;
    const start = Number(m[1]);
    const length = m[2] === undefined ? 1 : Math.max(Number(m[2]), 1);
    spans.push([start, start + length - 1]);
  }
  return spans;
}

export type ClaimAudit = { sha: string; subject: string; path: string; claimed: string[]; untouched: string[] };

export function auditCommit(sha: string): ClaimAudit | undefined {
  const subject = git(['log', '-1', '--format=%s', sha]).trim();
  const claim = EDIT_CLAIM.exec(subject);
  if (!claim) return undefined;
  const claimed = [...claim[1]!.matchAll(SECTION)].map(m => m[1]!);
  if (claimed.length === 0) return undefined;

  const markdown = git(['show', '--name-only', '--format=', sha]).split('\n').filter(f => f.endsWith('.md'));
  if (markdown.length !== 1) return undefined;            // 어느 문서의 §인지 못 잇는다 ⇒ 보류
  const path = markdown[0]!;

  const ranges = sectionRanges(sha, path);
  const spans = touchedSpans(sha, path);
  const untouched = claimed.filter(name => {
    const range = ranges.get(name);
    if (!range) return false;                             // 그 문서의 절이 아니다 ⇒ 보류
    return !spans.some(([a, b]) => !(b < range[0] || a > range[1]));
  });
  return untouched.length > 0 ? { sha, subject, path, claimed, untouched } : undefined;
}

/**
 * ⭐ 자를 먼저 건다 — 양성과 음성이 «같은 커밋» 안에 있다.
 *
 * ⛔ 음성을 «다른 커밋»에서 고르면 퇴화한다: 그 커밋의 제목이 편집 동사에 안 걸리거나 그 §이 그
 *    문서에 없으면 «보류»로 통과해서, hunk 비교를 «한 번도 안 타고» 초록이 난다. 실제로 두 번 그랬다
 *    (`ca3e12e18` 은 제목이 「고쳤다」라 동사 목록 밖 · `668612cf8` 은 그 문서에 `## §8` 이 없다).
 * ✅ 그래서 음성은 «같은 커밋»의 §2·§6 으로 잡는다 — 그 둘은 그 커밋이 «실제로» 만졌다.
 *    ⇒ HUNK 를 부러뜨리면 spans 가 비어 §2·§6 까지 적발되므로, 이 음성 arm 이 «문다».
 */
function selfCheck(): number {
  const fixture = 'a4fd0813a';                // #14904 — 제목이 §0·§2·§6 갱신, hunk 는 §2·§6 뿐
  const got = auditCommit(fixture);
  const caughtZero = got?.untouched.includes('0') === true;
  const sparedTouched = got !== undefined && !got.untouched.includes('2') && !got.untouched.includes('6');
  console.log(`알려진 양성 ${fixture} §0(안 만짐): ${caughtZero ? '✅ 잡았다' : '⛔ 놓쳤다'}`);
  console.log(`알려진 음성 ${fixture} §2·§6(만졌다): ${sparedTouched ? '✅ 안 잡았다' : '⛔ 위양성'}`);
  console.log(`   ⇒ 적발된 절: ${JSON.stringify(got?.untouched ?? [])}`);
  if (!caughtZero || !sparedTouched) {
    console.log('⛔ 자가 고장났다 — 이 자로 잰 「0건」을 믿지 마라.');
    return 1;
  }
  console.log('✅ 자가 산다 (양성·음성 둘 다 hunk 비교를 «탄다»).');
  return 0;
}

function main(): number {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-check')) return selfCheck();

  const sinceIndex = argv.indexOf('--since');
  const explicit = argv.filter(a => !a.startsWith('--') && a !== argv[sinceIndex + 1]);
  const shas = explicit.length > 0
    ? explicit
    : git(['log', '--since', sinceIndex >= 0 ? argv[sinceIndex + 1] ?? '1 day ago' : '1 day ago', '--format=%H'])
        .split('\n').filter(Boolean);

  const hits = shas.map(auditCommit).filter((h): h is ClaimAudit => h !== undefined);
  console.log(`훑은 커밋 ${shas.length} · ⚠️ 적발 ${hits.length}`);
  for (const hit of hits) {
    console.log(`  ${hit.sha.slice(0, 9)}  §${hit.untouched.join(' §')} 안 만짐 (주장: §${hit.claimed.join(' §')})  ${hit.path}`);
    console.log(`       ${hit.subject.slice(0, 78)}`);
  }
  if (shas.length === 0) console.log('⚠️ 훑은 커밋이 0이다 — 「0건」이 아니라 «못 셌다»이다.');
  return 0;
}

if (import.meta.main) process.exit(main());
