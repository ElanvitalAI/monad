import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** `I-T4` — git 호출 규율을 **기계가** 검사한다.
 *
 *  ⛔⭐⭐⭐ **왜 「관문 단일화」를 재나 — 다른 자를 먼저 써 보고 버렸다**(2026-08-03 실측):
 *  ⑴ *문서·스크립트의 셸 스니펫에서 `GIT-T6`(파이프 뒤 `$?`)·`GIT-T15`(실패 뒤 쓰기)·`GIT-T16`(백틱)
 *     형태를 잡는다* → 파일 2498·코드블록 7193·줄 67529 를 훑어 **백틱 0건 · 파이프 5건(전부 오탐 또는
 *     의도된 교육용 예시) · 쓰기 연쇄 18건(대부분 무해한 낡은 인계)**. ⇒ **분모가 비었다.** 실제 사고는
 *     커밋된 텍스트가 아니라 **사람이 친 임시 명령**이었고, 저장소 린트는 원리상 그것을 못 본다.
 *  ⑵ *`src` 의 git 호출을 쓰기/읽기로 갈라 재시도 심 통과를 잰다* → 62곳 중 **43곳이 동적 인자**라
 *     줄 단위로 분류 불가(31%만 보인다). ⛔ **그 자로 만든 린트는 69%를 조용히 통과시킨다** —
 *     36차 `harness clean` 이 0개를 보면서 *"정리 대상 없음"* 이라 말한 것과 같은 결함이다.
 *  ⇒ ⭐ **남은 자가 이것이다**: 인자를 몰라도 **「git 프로세스를 심 밖에서 띄웠나」는 100% 판정된다.**
 *     그리고 이것이 `GIT-T10`(*"락 재시도가 `worktree add` 한 곳에만 배선돼 있다"*)의 **구조적 원인**이다 —
 *     관문이 없으니 재시도를 배선할 자리가 없다.
 *
 *  ⛔ **이 린트가 못 하는 것**(문서화된 경계 — 이것으로 「git 규율이 지켜진다」고 읽지 마라):
 *  - 사람·에이전트가 셸에 **직접 친** 명령 (`GIT-T6`·`GIT-T15`·`GIT-T16` 의 실제 발생 자리)
 *  - 심 안쪽에서 rc 를 안 보는 것 (관문을 지나갔는지만 본다)
 */

/** git 프로세스를 띄우는 것이 **허용된** 자리. 이 밖에서 띄우면 관문을 우회한 것이다. */
export const GIT_SEAM_PREFIXES = ['src/git-fs/'] as const;

/** ⛔ 한 줄에 여러 형태가 걸려도 **한 자리로 센다**(중복 계수 금지). */
// ⛔ 각 패턴이 무엇을 잡는지는 **윗줄 주석**으로 적는다 — 같은 줄 꼬리에 예시를 적으면
//    이 파일이 자기 자신을 위반으로 읽는다(실측: 그렇게 써서 in-seam 이 4건 부풀었다).
//    ⑴ node child_process 배열형 · ⑵ 문자열형 · ⑶ Bun.spawn · ⑷ Bun shell 템플릿
const SPAWN_PATTERNS: readonly RegExp[] = [
  /\b(?:spawnSync|spawn|execFileSync|execFile)\s*\(\s*(['"`])git\1/,
  // ⛔ `execSync('git')`(인자 없음)도 잡는다 — 초판은 `git` 뒤에 공백을 요구해 **인자 없는 호출을 놓쳤다**(리뷰 3라운드)
  /\b(?:execSync|exec)\s*\(\s*(['"`])git(?:\s|\1)/,
  /\bBun\.spawn(?:Sync)?\s*\(\s*\[\s*(['"`])git\1/,
  // ⛔ 객체형 `Bun.spawn({ cmd: ['git', …] })` — 배열형만 보면 우회된다(리뷰 3라운드)
  /\bcmd\s*:\s*\[\s*(['"`])git\1/,
  /\$`git[\s`]/,
];

/** ⭐ 의도적으로 관문 밖에 두는 자리는 **이 표식**을 같은 줄 또는 바로 윗줄에 단다.
 *  ⛔ 표식에는 이유를 함께 적는다 — 이유 없는 면제는 다음 사람이 못 옮긴다(`D3`). */
export const EXEMPT_MARKER = 'git-spawn-allow:';

export interface GitSpawnSite {
  file: string;
  line: number;
  text: string;
  exemptReason?: string;
}

export interface GitSpawnDisciplineResult {
  /** 관문(`GIT_SEAM_PREFIXES`) 안쪽 호출 — 정상 */
  inSeam: GitSpawnSite[];
  /** 관문 밖 · 표식 없음 — 래칫 대상 */
  outsideSeam: GitSpawnSite[];
  /** 관문 밖 · 표식 있음 — 유예 */
  exempt: GitSpawnSite[];
  counts: { total: number; inSeam: number; outsideSeam: number; exempt: number; files: number };
  /** ⭐ 래칫에서 뺀 테스트 파일 — **보이는 유예**(숨은 우회로가 아니다) */
  skippedTests?: { files: number; spawns: number };
}

function isSeam(file: string): boolean {
  return GIT_SEAM_PREFIXES.some((prefix) => file.startsWith(prefix));
}

/** ⛔⭐⭐⭐ **테스트 파일은 래칫에서 뺀다 — 그러나 조용히 빼지 않는다**(리뷰 3라운드 지적).
 *  테스트는 픽스처 저장소를 만들려고 **정당하게** 생 git 을 띄운다. 그것을 래칫에 넣으면 잡음이 된다.
 *  ⛔ 그러나 *"빼고 나서 「깨끗하다」라고 말하는 것"* 이 36차 `harness clean` 의 결함이었다.
 *  ⇒ 뺀 것을 **세어서 요약에 적는다**(`test-files=… spawns-in-tests=…`). 숨은 우회로가 아니라 **보이는 유예**다. */
function isTestFile(file: string): boolean {
  return /\.test\.tsx?$/.test(file);
}

function collectSourceFiles(root: string): { scanned: string[]; tests: string[] } {
  const scanned: string[] = [];
  const tests: string[] = [];
  const walk = (dir: string): void => {
    for (const dirent of readdirSync(dir, { withFileTypes: true })) {
      const child = join(dir, dirent.name);
      if (dirent.isDirectory()) {
        if (dirent.name === 'node_modules' || dirent.name.startsWith('.')) continue;
        walk(child);
      } else if (/\.tsx?$/.test(dirent.name)) {
        // ⭐ `.tsx` 도 본다 — 초판은 `.ts` 만 봐서 `.tsx` 가 통째로 우회로였다(리뷰 3라운드).
        (isTestFile(child) ? tests : scanned).push(child);
      }
    }
  };
  walk(root);
  return { scanned: scanned.sort(), tests: tests.sort() };
}

/** ⛔⭐⭐⭐ 줄 단위·줄머리 휴리스틱으로 재면 **셋 다 우회된다**(리뷰 must-fix 2라운드 · 2026-08-03):
 *      ⑴ 여러 줄 호출          spawnSync(⏎ 'git', […])
 *      ⑵ 블록 주석             / * … * / 안의 예시가 호출로 잡히고, 같은 줄 뒤의 **진짜 호출은 지워졌다**
 *      ⑶ 문자열 안의 표식      바로 윗줄의 문자열 `"git-spawn-allow: …"` 만으로 면제됐다
 *  ⇒ **한 번 훑는 스캐너**로 주석·문자열 상태를 추적한다. 주석은 **같은 길이의 공백으로 지우고**
 *  (지운 자리를 따로 모아 면제 표식은 **주석 안에서만** 읽는다), 문자열은 그대로 둔다.
 *  ⭐ 길이를 보존하므로 매치 offset 이 원본 줄 번호로 1:1 되돌아간다. */
interface ScannedSource {
  /** 주석이 같은 길이 공백으로 지워진 본문 — 탐지는 여기서만 한다 */
  code: string;
  /** 줄별 주석 원문(면제 표식은 여기서만 읽는다) */
  commentByLine: string[];
  /** ⛔⭐⭐⭐ **문자열 추적은 계산은 하되 판정에 쓰지 않는다 — 반론(리뷰 3라운드 must-fix ①).**
   *
   *  지적: `const s = "spawnSync('git', …)"` 같은 **데이터**가 호출로 잡힌다(오탐). 맞다.
   *  ⛔ **그러나 그대로 고치니 진짜 호출을 놓쳤다** — 실측:
   *  ```
   *  문자열 시작 매치를 버리자   outside-seam 56 → 50
   *  그런데 사라진 것 중         gate-baseline.ts:315  spawnSync('git', ['worktree','add',…])   ← 진짜 호출
   *                             mission-reconcile.ts:238  execSync(`git ${args}`)              ← 진짜 호출
   *  ```
   *  원인: 정규식 리터럴 안의 따옴표(`/['"]/` 류)에서 상태가 어긋나 **그 뒤 파일 전체가 문자열로 먹힌다.**
   *  정규식 리터럴과 나눗셈을 가르려면 사실상 파서가 필요하다.
   *
   *  ⇒ ⭐⭐⭐ ***게이트에서 오탐과 미탐은 대칭이 아니다.*** 오탐은 **기준선을 부풀릴 뿐**이고,
   *  미탐은 **우회로를 연다.** 그래서 이 자는 **오탐 쪽으로 틀어 둔다.**
   *  ⚠️ 오탐이 실제로 몇인지는 **안 쟀다** — 재려면 AST 가 필요하고 그것은 이 PR 밖이다. */
  inString: boolean[];
}

function scanSource(source: string): ScannedSource {
  const code: string[] = [];
  const commentByLine: string[] = source.split('\n').map(() => '');
  const inString: boolean[] = new Array(source.length).fill(false);
  let line = 0;
  let state: 'code' | 'line-comment' | 'block-comment' | 'single' | 'double' | 'template' = 'code';
  for (let index = 0; index < source.length; index++) {
    const ch = source[index]!;
    const next = source[index + 1];
    const inComment = state === 'line-comment' || state === 'block-comment';
    // ⭐ **여는 따옴표 다음 글자부터** 문자열 안쪽이다 — 여는 따옴표 자체는 코드다.
    inString[index] = state === 'single' || state === 'double' || state === 'template';
    if (ch === '\n') {
      code.push('\n');
      line++;
      if (state === 'line-comment') state = 'code';
      continue;
    }
    if (state === 'code') {
      if (ch === '/' && next === '/') { state = 'line-comment'; code.push(' '); commentByLine[line] += ch; continue; }
      if (ch === '/' && next === '*') { state = 'block-comment'; code.push(' '); commentByLine[line] += ch; continue; }
      if (ch === "'") state = 'single';
      else if (ch === '"') state = 'double';
      else if (ch === '`') state = 'template';
      code.push(ch);
      continue;
    }
    if (inComment) {
      commentByLine[line] += ch;
      code.push(' ');
      if (state === 'block-comment' && ch === '*' && next === '/') {
        // ⛔ 닫는 `/` 도 지워야 그 뒤의 진짜 호출이 살아난다(길이는 그대로).
        commentByLine[line] += '/';
        code.push(' ');
        index++;
        state = 'code';
      }
      continue;
    }
    // 문자열 안 — 이스케이프를 건너뛴다(닫는 따옴표를 놓치면 그 뒤 전부가 문자열로 먹힌다)
    if (ch === '\\') { code.push(ch); if (next !== undefined) { code.push(next); index++; } continue; }
    if ((state === 'single' && ch === "'") || (state === 'double' && ch === '"') || (state === 'template' && ch === '`')) state = 'code';
    code.push(ch);
  }
  return { code: code.join(''), commentByLine, inString };
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index++) if (source[index] === '\n') starts.push(index + 1);
  return starts;
}

function lineOf(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (starts[mid]! <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

/** 한 파일의 본문에서 git 스폰 자리를 찾는다. 파일 읽기와 분리해 테스트가 픽스처로 물 수 있게 한다. */
export function findGitSpawnSites(file: string, source: string): GitSpawnSite[] {
  const lines = source.split('\n');
  const starts = lineStarts(source);
  const { code, commentByLine, inString } = scanSource(source);
  // ⛔⭐ 중복 제거는 **줄이 아니라 호출 위치(offset)** 로 한다(리뷰 must-fix 2라운드) —
  //    줄로 접으면 `spawnSync('git',…); spawnSync('git',…);` 처럼 **같은 줄에 호출을 하나 더 얹어
  //    기준선을 안 늘리는 우회**가 생긴다. offset 이면 한 호출이 여러 패턴에 걸릴 때만 접힌다.
  const offsets = new Set<number>();
  for (const pattern of SPAWN_PATTERNS) {
    const global = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`);
    for (const match of code.matchAll(global)) offsets.add(match.index);
  }
  return [...offsets].sort((a, b) => a - b).map((offset) => {
    const line = lineOf(starts, offset);
    const text = lines[line - 1] ?? '';
    // ⭐ 표식은 같은 줄 또는 **바로 윗줄의 주석**에서만 읽는다.
    //    ⛔ 주석으로 한정한다(리뷰 must-fix 2라운드) — 문자열 리터럴 `'git-spawn-allow: …'` 만으로
    //    면제되면 데이터가 규율을 끄게 된다. ⊕ 멀리 있는 표식이 아래 전부를 면제하면 면제가 번진다.
    const marked = [commentByLine[line - 1] ?? '', commentByLine[line - 2] ?? '']
      .find((candidate) => candidate.includes(EXEMPT_MARKER));
    const exemptReason = marked?.slice(marked.indexOf(EXEMPT_MARKER) + EXEMPT_MARKER.length).trim() || undefined;
    return { file, line, text: text.trim(), ...(exemptReason ? { exemptReason } : {}) };
  });
}

export function lintGitSpawnSites(sites: readonly GitSpawnSite[]): GitSpawnDisciplineResult {
  const inSeam = sites.filter((site) => isSeam(site.file));
  const outside = sites.filter((site) => !isSeam(site.file));
  const exempt = outside.filter((site) => site.exemptReason !== undefined);
  const outsideSeam = outside.filter((site) => site.exemptReason === undefined);
  return {
    inSeam,
    outsideSeam,
    exempt,
    counts: {
      total: sites.length,
      inSeam: inSeam.length,
      outsideSeam: outsideSeam.length,
      exempt: exempt.length,
      files: new Set(sites.map((site) => site.file)).size,
    },
  };
}

export const GIT_SPAWN_SCAN_ROOTS = ['src', 'scripts'] as const;

type GitSpawnScanRoots = string | readonly string[];

function normalizeScanRoots(roots: GitSpawnScanRoots): readonly string[] {
  return typeof roots === 'string' ? [roots] : roots;
}

export function scanGitSpawnDiscipline(roots: GitSpawnScanRoots = GIT_SPAWN_SCAN_ROOTS): GitSpawnDisciplineResult {
  const collected = normalizeScanRoots(roots).map(collectSourceFiles);
  const scanned = collected.flatMap(({ scanned: files }) => files);
  const tests = collected.flatMap(({ tests: files }) => files);
  const sites = scanned.flatMap((file) => findGitSpawnSites(file, readFileSync(file, 'utf8')));
  const spawnsInTests = tests.reduce((sum, file) => sum + findGitSpawnSites(file, readFileSync(file, 'utf8')).length, 0);
  return { ...lintGitSpawnSites(sites), skippedTests: { files: tests.length, spawns: spawnsInTests } };
}

/** 파일별 관문-밖 호출 수. 래칫 비교의 단위다(줄 번호는 편집으로 흔들리므로 쓰지 않는다). */
export function countsByFile(result: GitSpawnDisciplineResult): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const site of result.outsideSeam) counts[site.file] = (counts[site.file] ?? 0) + 1;
  return counts;
}

export interface RatchetComparison {
  /** 기준선에 없던 파일 — 기준선 미설정이라 회귀 판정 대상이 아니다 */
  unbaselined: { file: string; current: number }[];
  /** 기준선과 같은 수 — 현재 유예로 보고한다 */
  deferred: { file: string; baseline: number; current: number }[];
  /** 기준선에 있던 파일의 수가 늘었다 — ⛔ 회귀 */
  regressions: { file: string; baseline: number; current: number }[];
  /** 줄었다 — ✅ 진전. 기준선을 낮춰야 한다(실패는 아니다) */
  improvements: { file: string; baseline: number; current: number }[];
  /** 기준선에만 있고 지금은 0 — 기준선 항목이 낡았다 */
  stale: string[];
}

export function compareToBaseline(
  current: Record<string, number>,
  baseline: Record<string, number>,
): RatchetComparison {
  const unbaselined: RatchetComparison['unbaselined'] = [];
  const deferred: RatchetComparison['deferred'] = [];
  const regressions: RatchetComparison['regressions'] = [];
  const improvements: RatchetComparison['improvements'] = [];
  for (const [file, count] of Object.entries(current)) {
    if (!(file in baseline)) {
      unbaselined.push({ file, current: count });
      continue;
    }
    const allowed = baseline[file]!;
    if (count > allowed) regressions.push({ file, baseline: allowed, current: count });
    else if (count < allowed) improvements.push({ file, baseline: allowed, current: count });
    else deferred.push({ file, baseline: allowed, current: count });
  }
  const stale = Object.keys(baseline).filter((file) => (current[file] ?? 0) === 0).sort();
  unbaselined.sort((a, b) => a.file.localeCompare(b.file));
  deferred.sort((a, b) => a.file.localeCompare(b.file));
  regressions.sort((a, b) => a.file.localeCompare(b.file));
  improvements.sort((a, b) => a.file.localeCompare(b.file));
  return { unbaselined, deferred, regressions, improvements, stale };
}

export function renderGitSpawnDiscipline(result: GitSpawnDisciplineResult, comparison?: RatchetComparison): string {
  const lines: string[] = [];
  for (const { file, current } of comparison?.unbaselined ?? []) {
    lines.push(`⚠️ unbaselined ${file} current=${current}`);
  }
  for (const { file, baseline, current } of comparison?.deferred ?? []) {
    lines.push(`⏸️ deferred ${file} baseline=${baseline} current=${current}`);
  }
  for (const { file, baseline, current } of comparison?.regressions ?? []) {
    lines.push(`⛔ regression ${file} baseline=${baseline} current=${current}`);
  }
  for (const { file, baseline, current } of comparison?.improvements ?? []) {
    lines.push(`✅ improved ${file} baseline=${baseline} current=${current}`);
  }
  for (const file of comparison?.stale ?? []) lines.push(`⚠️ stale-baseline ${file}`);
  lines.push(
    `summary total=${result.counts.total} in-seam=${result.counts.inSeam}`
    + ` outside-seam=${result.counts.outsideSeam} exempt=${result.counts.exempt}`
    + ` files=${result.counts.files}`
    // ⛔ 뺀 것을 말한다 — 침묵하면 「전부 봤다」로 읽힌다.
    + (result.skippedTests ? ` test-files=${result.skippedTests.files} spawns-in-tests=${result.skippedTests.spawns}` : '')
    + (comparison ? ` unbaselined=${comparison.unbaselined.length} regressions=${comparison.regressions.length}` : ''),
  );
  return lines.join('\n');
}

/** ⛔ 진전·낡은 기준선은 **실패가 아니다** — 유예분을 판정층 입력으로 쓰면 판정이 거짓이 된다.
 *  기준선이 없는 호출은 아직 유예가 아니므로 strict에서 차단한다. 기존의 `baseline[file] ?? 0`은
 *  이를 회귀로 오인했지만, 별도 문면으로 구별하면서도 차단 의미는 보존한다.
 *  ⭐ 파일 시스템과 분리해 둔다 — 이 의미를 저장소 상태에 결합하면 무관한 변경이 이 테스트를 깨고,
 *  그러면 규칙이 아니라 그때의 저장소를 시험하는 것이 된다(실측: 뮤테이션 프로브가 이 테스트를 깼다). */
export function gitSpawnExitCode(comparison: RatchetComparison, strict: boolean): number {
  return strict && (comparison.regressions.length > 0 || comparison.unbaselined.length > 0) ? 1 : 0;
}

export function runGitSpawnDiscipline(
  roots: GitSpawnScanRoots = GIT_SPAWN_SCAN_ROOTS,
  baseline: Record<string, number> = {},
  strict = false,
): { output: string; exitCode: number; result: GitSpawnDisciplineResult; comparison: RatchetComparison } {
  const result = scanGitSpawnDiscipline(roots);
  const comparison = compareToBaseline(countsByFile(result), baseline);
  return {
    output: renderGitSpawnDiscipline(result, comparison),
    exitCode: gitSpawnExitCode(comparison, strict),
    result,
    comparison,
  };
}
