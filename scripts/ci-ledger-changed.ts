/**
 * 변경분 스코프 원장 게이트 — **이 브랜치가 더하거나 고친 항목만** 검사한다.
 *
 * ⛔ **전 항목 strict 는 못 켠다**: 기존 위반이 323건이라(2026-08-01 실측) 첫날부터 무의미해진다.
 *   `scripts/ci-typecheck-changed.ts` 와 같은 이유·같은 패턴이다.
 *
 * ⛔⭐ **"안 돌았다" 와 "문제 없다" 는 다른 값이다**(tsc 게이트가 같은 구멍으로 `PASS` 를 찍은 적이 있다).
 *   base 를 못 찾거나 파일을 못 읽으면 **0건이라 통과**시키지 않고 **fail-closed** 로 알린다.
 *
 * 규약 문면 = `내부 문서 `README`` §0b(무위반 43건에서 귀납).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { lintLedgerEntries, parseLedgerDocument, type LedgerEntry } from '../src/harness/ledger-lint.js';

const LEDGER_DIR = 'docs/harness';
// ⛔⭐ 이 상한이 «왜» 이 값인가 — 다음 사람이 다시 재지 않도록 근거를 여기 남긴다.
//   기본값(Node 1MB)으로는 이 저장소의 원장 하나가 이미 «넘어» `ENOBUFS` 로 죽었고,
//   그 실패가 「빈 내용」으로 접혀 항목 902건이 통째로 「새 항목」이 됐다(2026-09-05 · 총 937건 오탐).
//   📏 그날 실측한 최대 원장 = 1,670,175 바이트. 64MiB 는 그 «약 40배» 여유다.
//   ⚠️ 그래도 상한은 상한이다 — 넘으면 이 게이트는 «조용히 통과하지 않고» fail-closed 로 이름을 댄다.
//   📌 다시 재는 명령:  ls -l 내부 문서 `ISSUES` | awk '{print $5}' | sort -n | tail -1
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

interface GitRun { out: string; ok: boolean; why?: string }
type BaseFileRead =
  | { kind: 'present'; text: string }
  | { kind: 'missing' }
  | { kind: 'failure'; why: string };

function git(args: string[]): GitRun {
  try {
    return {
      out: execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: GIT_MAX_BUFFER }),
      ok: true,
    };
  } catch (error) {
    const e = error as { status?: number; stderr?: string };
    const why = (e.stderr ?? '').trim() || `git 종료코드 ${String(e.status)}`;
    return { out: '', ok: false, why };
  }
}

/** 이 브랜치가 갈라져 나온 지점. 못 찾으면 **통과시키지 않는다**. */
function mergeBase(): GitRun {
  for (const ref of ['origin/main', 'main']) {
    const r = git(['merge-base', 'HEAD', ref]);
    if (r.ok && r.out.trim()) return { out: r.out.trim(), ok: true };
  }
  return { out: '', ok: false, why: 'origin/main·main 어느 쪽으로도 merge-base 를 못 찾았다' };
}

function ledgerFiles(): string[] {
  if (!existsSync(LEDGER_DIR)) return [];
  const files: string[] = [];
  for (const area of readdirSync(LEDGER_DIR, { withFileTypes: true })) {
    if (!area.isDirectory()) continue;
    const issues = join(LEDGER_DIR, area.name, 'ISSUES.md');
    if (existsSync(issues)) files.push(issues);
  }
  return files.sort();
}

/** 파일·제목·본문이 모두 같은 항목만 기존 항목이다. */
const keyOf = (entry: LedgerEntry): string => `${entry.file}\u0000${entry.title}\u0000${entry.body.trim()}`;

function readBaseFile(ref: string, file: string): BaseFileRead {
  // `git show`의 128·stderr는 ref 오류와 경로 부재를 구분하지 못한다.
  // ls-tree의 NUL-구분 트리 항목만 기준 ref 안의 정확한 경로 존재 증거로 쓴다.
  const tree = git(['ls-tree', '-z', '--full-tree', ref, '--', file]);
  if (!tree.ok) return { kind: 'failure', why: tree.why! };
  const found = tree.out.split('\u0000').some((record) => record.endsWith(`\t${file}`));
  if (!found) return { kind: 'missing' };

  const shown = git(['show', `${ref}:${file}`]);
  if (!shown.ok) return { kind: 'failure', why: shown.why! };
  return { kind: 'present', text: shown.out };
}

function readBaseEntries(ref: string, file: string): { text: string; entries: LedgerEntry[]; failure?: string } {
  const result = readBaseFile(ref, file);
  if (result.kind === 'missing') return { text: '', entries: [] };
  if (result.kind === 'failure') return { text: '', entries: [], failure: `${file}: ${result.why}` };
  return { text: result.text, entries: parseLedgerDocument(file, result.text) };
}

function headEntries(file: string): { text: string; entries: LedgerEntry[] } {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  return { text, entries: text ? parseLedgerDocument(file, text) : [] };
}

const base = mergeBase();
if (!base.ok) {
  console.error(`[ledger-gate] ⛔ FAIL — base 를 못 찾아 검사 범위를 정할 수 없다: ${base.why}`);
  console.error('[ledger-gate] "검사할 것이 없다" 와 "검사하지 못했다" 는 다른 값이다 — fail-closed.');
  process.exit(1);
}

const files = ledgerFiles();
if (files.length === 0) {
  console.error(`[ledger-gate] ⛔ FAIL — ${LEDGER_DIR} 아래에서 ISSUES.md 를 하나도 못 찾았다(경로가 바뀌었나?).`);
  process.exit(1);
}

const changed: LedgerEntry[] = [];
const blind: string[] = [];
const unreadable: string[] = [];
for (const file of files) {
  const prior = readBaseEntries(base.out, file);
  if (prior.failure) {
    unreadable.push(prior.failure);
    continue;
  }
  const head = headEntries(file);

  // ⛔⭐ **파일은 바뀌었는데 항목이 하나도 안 파싱되면 "위반 없음" 이 아니라 "못 읽었다" 다.**
  //   제목 형식이 `###` 에서 벗어나는 순간(깊이·기호 변경) 파서가 0건을 내고, 그러면 이 게이트가
  //   *"더하거나 고친 항목이 없다"* 며 **조용히 통과**한다 — 규약 위반 항목이 통째로 들어와도 그렇다.
  //   ⇒ 같은 계열의 실측 사례: `--hold` 의 ready 판정이 `endsWith('\talive')` 라 컬럼 하나 붙자
  //     영영 거짓이 됐다(`[T]` 2026-08-01). ***형식에 결합된 판정은 형식이 움직이면 소리 없이 뒤집힌다.***
  if (head.text.trim() && head.entries.length === 0) {
    blind.push(`${file} — 본문은 있는데 파싱된 항목 0건 (제목이 '### ' 형식인가?)`);
    continue;
  }
  if (prior.text.trim() !== head.text.trim() && head.entries.length === prior.entries.length
      && head.entries.every((entry, index) => keyOf(entry) === keyOf(prior.entries[index]!))) {
    blind.push(`${file} — 파일은 바뀌었는데 파서가 본 항목은 전부 동일 (항목 밖 변경이거나 파싱 누락)`);
    continue;
  }

  const before = new Map<string, number>();
  for (const entry of prior.entries) {
    const key = keyOf(entry);
    before.set(key, (before.get(key) ?? 0) + 1);
  }
  for (const entry of head.entries) {
    const key = keyOf(entry);
    const count = before.get(key) ?? 0;
    // 새 항목이거나 제목·본문이 달라진 항목만 — 손대지 않은 기존 부채는 이 게이트의 대상이 아니다.
    if (count === 0) changed.push(entry);
    else before.set(key, count - 1);
  }
}

if (unreadable.length > 0) {
  console.error('[ledger-gate] ⛔ FAIL — 기준 revision 원장 파일을 읽지 못했다(검사하지 못했다):');
  for (const failure of unreadable) console.error(`  ${failure}`);
  console.error('\n"위반 없음" 과 "못 읽었다" 는 다른 값이다 — fail-closed.');
  process.exit(1);
}

if (blind.length > 0) {
  console.error('[ledger-gate] ⛔ FAIL — 파서가 눈이 먼 파일이 있다(검사하지 못했다):');
  for (const b of blind) console.error(`  ${b}`);
  console.error('\n"위반 없음" 과 "못 읽었다" 는 다른 값이다 — fail-closed.');
  console.error('항목 제목은 `### <ID> · <날짜> · **<상태>** — <제목>` 이다(docs/harness/README.md §0b).');
  process.exit(1);
}

if (changed.length === 0) {
  console.log('[ledger-gate] 변경 항목 0건 검사 (변경분 스코프).');
  console.log('[ledger-gate] PASS — 이 브랜치가 더하거나 고친 원장 항목이 없다.');
  process.exit(0);
}

const result = lintLedgerEntries(changed);
const violations = result.violations;

console.log(`[ledger-gate] 변경 항목 ${changed.length}건 검사 (변경분 스코프).`);
if (violations.length === 0) {
  console.log('[ledger-gate] PASS — 변경 항목에 규약 위반 없음.');
  process.exit(0);
}

const byTitle = new Map<string, string[]>();
for (const v of violations) byTitle.set(v.title, [...(byTitle.get(v.title) ?? []), v.check]);
console.error(`\n[ledger-gate] ⛔ FAIL — 변경 항목 ${byTitle.size}건에 위반 ${violations.length}건:`);
for (const [title, checks] of byTitle) console.error(`  ${title.slice(0, 90)}\n    → ${checks.join(' · ')}`);
console.error('\n규약 = docs/harness/README.md §0b (무위반 43건에서 귀납).');
console.error('  status-vocab : 제목의 **…** 안에 fixed 또는 open');
console.error('  four-lines   : 본문에 **근본** ⊕ **근거** (⊕ 관례상 **처분**·**교훈**)');
console.error('  linkage      : F-<n>/I-<n> 을 최소 하나 — ⛔ 미착지 I-<n> 을 처분에 걸면 그 자체가 위반');
process.exit(1);
