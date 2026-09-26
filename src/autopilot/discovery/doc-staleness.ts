import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { lintDocLinks } from './doc-lint.js';
import { scanDocs, staleScore, type DocEntry } from './doc-inventory.js';
import { inlineCodeIdentifiers, sourceIdentifierInventory } from './source-identifiers.js';

export type IdentifierBranch = 'current' | 'recently-removed' | 'long-removed' | 'javascript-keyword' | 'document-label' | 'uppercase-status' | 'string-literal' | 'non-typescript-source' | 'unclassified';

export interface IdentifierClassification {
  identifier: string;
  branch: IdentifierBranch;
}

/** 사라진 이름 하나가 문서에서 «어디에» 나오나. ⛔ 상한에 닿으면 `more` 가 그 사실을 «센다». */
export interface RemovedIdentifierSite {
  identifier: string;
  /** 1-index 줄 번호 — 사람이 에디터에서 바로 열 수 있는 값. */
  line: number;
  /** 그 줄의 문면(공백 접고 잘림). ⛔ 잘렸으면 끝에 `…` 가 붙는다. */
  text: string;
  /** 같은 이름이 더 나오는 줄 수. 0 이면 이것이 전부다. */
  more: number;
}

/** 이름 하나당 담는 줄 수 상한. ⛔ 넘으면 `more` 로 «센다» — 조용히 버리지 않는다. */
export const REMOVED_IDENTIFIER_SITE_LIMIT = 3;
/** 문면 상한. 넘으면 `…` 를 붙여 «잘렸음»을 보인다. */
export const REMOVED_IDENTIFIER_SITE_TEXT_LIMIT = 100;

/** 문서가 스스로 선언한 판과 호출자가 제공한 이력 최고 판의 관계. */
export type DeclaredRevisionBranch =
  | 'no-declaration'
  | 'invalid-declaration'
  | 'ambiguous-declaration'
  | 'history-unavailable'
  | 'history-empty'
  | 'history-invalid'
  | 'equal'
  | 'behind'
  | 'ahead';

/** `현재 판/버전`, `current revision/version` 라벨 뒤의 `v숫자`만 자기 판 선언으로 읽는다. */
export interface DeclaredRevisionCandidate {
  revision: number | null;
  line: number;
  text: string;
  rule: 'current-revision-label';
}

/** 순수 비교 산출: 선택 규칙과 후보를 함께 내어 판정 통과를 선언 정확성으로 오해하지 않게 한다. */
export interface DeclaredRevisionAssessment {
  branch: DeclaredRevisionBranch;
  selection: 'current-revision-label';
  declarations: DeclaredRevisionCandidate[];
  declaredRevision: number | null;
  highestHistoryRevision: number | null;
  gap: number | null;
}

const CURRENT_REVISION_DECLARATION = /(?<![\p{L}\p{N}_])(?:현재\s*(?:판|버전)(?=\s|=|:|은|는|$)|current\s*(?:revision|version)(?=\s|=|:|$))\s*(?:=|:|은|는)?\s*(v\d+(?![\p{L}\p{N}_])|[^\s,.;)\]}]+)/giu;

/**
 * 주어진 본문과 이력만 비교한다. `null` 이력은 호출자가 이력을 읽지 못했음을, 빈 배열은 읽었으나 판이 없음을 뜻한다.
 * 철회된 판은 이력에서 빼는 호출자의 책임이며, 여기서는 제공된 숫자 판의 최댓값만 쓴다.
 */
export function assessDeclaredRevision(text: string, history: readonly string[] | null): DeclaredRevisionAssessment {
  const declarations = text.split('\n').flatMap((line, index): DeclaredRevisionCandidate[] =>
    [...line.matchAll(CURRENT_REVISION_DECLARATION)].map((match) => ({
      revision: /^v\d+$/i.test(match[1]!) ? Number.parseInt(match[1]!.slice(1), 10) : null,
      line: index + 1,
      text: line.trim(),
      rule: 'current-revision-label' as const,
    })),
  );
  const base = { selection: 'current-revision-label' as const, declarations };
  if (declarations.length === 0) return { ...base, branch: 'no-declaration', declaredRevision: null, highestHistoryRevision: null, gap: null };
  if (declarations.length > 1) return { ...base, branch: 'ambiguous-declaration', declaredRevision: null, highestHistoryRevision: null, gap: null };
  const declaration = declarations[0]!;
  if (declaration.revision === null) return { ...base, branch: 'invalid-declaration', declaredRevision: null, highestHistoryRevision: null, gap: null };
  if (history === null) return { ...base, branch: 'history-unavailable', declaredRevision: declaration.revision, highestHistoryRevision: null, gap: null };
  if (history.length === 0) return { ...base, branch: 'history-empty', declaredRevision: declaration.revision, highestHistoryRevision: null, gap: null };
  const revisions = [...new Set(history.filter((value) => /^v\d+$/i.test(value)).map((value) => Number.parseInt(value.slice(1), 10)))];
  if (revisions.length === 0) return { ...base, branch: 'history-invalid', declaredRevision: declaration.revision, highestHistoryRevision: null, gap: null };
  const highestHistoryRevision = Math.max(...revisions);
  const gap = Math.abs(highestHistoryRevision - declaration.revision);
  const branch: DeclaredRevisionBranch = declaration.revision === highestHistoryRevision ? 'equal' : declaration.revision < highestHistoryRevision ? 'behind' : 'ahead';
  return { ...base, branch, declaredRevision: declaration.revision, highestHistoryRevision, gap };
}

export function locateRemovedIdentifiers(text: string, identifiers: readonly string[]): RemovedIdentifierSite[] {
  if (identifiers.length === 0) return [];
  const lines = text.split('\n');
  const sites: RemovedIdentifierSite[] = [];
  for (const identifier of identifiers) {
    // ⛔ 백틱으로 감싼 «인라인 코드»만 센다 — `inlineCodeIdentifiers` 와 «같은 자»를 써야
    //   「목록에는 있는데 줄은 없다」가 안 난다(두 자가 갈리면 그것이 오늘의 그 병이다).
    const needle = '`' + identifier + '`';
    const hits: number[] = [];
    for (let i = 0; i < lines.length; i++) if (lines[i]!.includes(needle)) hits.push(i + 1);
    if (hits.length === 0) continue;
    for (const line of hits.slice(0, REMOVED_IDENTIFIER_SITE_LIMIT)) {
      const raw = lines[line - 1]!.replace(/\s+/g, ' ').trim();
      sites.push({
        identifier,
        line,
        text: raw.length > REMOVED_IDENTIFIER_SITE_TEXT_LIMIT ? raw.slice(0, REMOVED_IDENTIFIER_SITE_TEXT_LIMIT) + '…' : raw,
        more: Math.max(0, hits.length - REMOVED_IDENTIFIER_SITE_LIMIT),
      });
    }
  }
  return sites;
}

export interface RemovedIdentifierHistory {
  identifier: string;
  /** `not-found` 는 이력 조회 실패·얕은 checkout·모호한 이름을 사건 없음으로 접지 않는다. */
  status: 'found' | 'not-found';
  commit?: { shortId: string; title: string };
}

export interface DocStalenessHistory {
  /** 이 보강을 요청했을 때만 붙는다. 기본 구조화 산출 계약은 그대로다. */
  removedIdentifierHistory: RemovedIdentifierHistory[];
}

export interface SourcePathSignals {
  /** 분석 가능한 코드 경로 후보 수. */
  checked: number;
  /** 현재 파일과 확장자 대안 모두 없는 경로 수. */
  missing: number;
  /** 요청 확장자는 없지만 같은 basename의 코드 확장자가 있는 오기 수. */
  extensionTypos: number;
  /** 예시·자리표시자라서 의도적으로 세지 않은 후보 수. */
  excludedExamples: number;
  /** 문서의 디렉터리 기준으로 해석해 실재한 후보 수. */
  resolvedFromDocument: number;
  /** ESM 지정자(`.js`/`.mjs`/`.cjs`)인데 같은 이름의 `.ts`/`.tsx`가 실재해 오기에서 뺀 수. */
  esmSpecifierResolved: number;
  /** 파일시스템 I/O 오류로 일부 또는 전부를 판별하지 못한 경우. */
  status?: 'unavailable';
  reason?: string;
}

/** `present`는 접근 가능 여부가 아니라 일반 파일이 실재한다는 뜻이다. */
export type SourcePathProbe = (path: string) => 'present' | 'missing' | 'unavailable';

export interface SourcePathSummary extends Omit<SourcePathSignals, 'status' | 'reason'> {
  /** 개별 문서 경로 평가 중 I/O 오류가 있었으면 0건과 분리한다. */
  status: 'ok' | 'unavailable';
  /** unavailable일 때 사람이 확인할 첫 오류 사유. */
  reason?: string;
}

export interface LineAnchorMismatch {
  /** 문서가 적은 코드 경로. */
  sourcePath: string;
  /** 문서가 적은 1-index 줄 번호. */
  citedLine: number;
  /** 문서가 같은 문맥에 함께 적은 심볼 이름. */
  symbol: string;
  /** 문서 안에서 이 인용이 나온 1-index 줄 번호. */
  documentLine: number;
  /** 사람이 바로 읽는 진단 한 줄. */
  diagnostic: string;
  /** 파일 부재 또는 허용 줄 범위 밖의 확인된 불일치만 mismatch 로 센다. */
  reason: 'symbol-outside-tolerance' | 'missing-file';
}

export interface LineAnchorUnavailable {
  /** 문서가 적은 코드 경로. */
  sourcePath: string;
  /** 문서가 적은 1-index 줄 번호. */
  citedLine: number;
  /** 문서가 같은 문맥에 함께 적은 심볼 이름. */
  symbol: string;
  /** 문서 안에서 이 인용이 나온 1-index 줄 번호. */
  documentLine: number;
  /** 관측 불가 사유. */
  reason: string;
  /** 사람이 바로 읽는 진단 한 줄. */
  diagnostic: string;
}

export interface LineAnchorSignals {
  /** path:line 과 심볼이 같은 문맥에 있어 판정한 인용 수. */
  checked: number;
  /** 파일이 없거나 허용 줄 범위 안에 심볼이 없어 사람에게 보여줄 진단 수. */
  mismatches: LineAnchorMismatch[];
  /** 파일시스템 I/O 오류로 확인하지 못한 인용. stale 판정에는 넣지 않는다. */
  unavailable: LineAnchorUnavailable[];
  /** path:line 은 있지만 같은 문맥에 심볼이 없어 의도적으로 판정하지 않은 수. */
  symbolLessCitations: number;
  /** ⭐ 「몇 건」만으로는 관행(`path:line` ⊕ 백틱 심볼)을 «고칠 수가 없다» — 어느 줄인지 필요하다.
   *  ⛔ 상한이 있다(`SYMBOL_LESS_SITE_CAP`) — ***이 배열의 length 를 분모로 쓰지 마라.***
   *  분모는 언제나 위 `symbolLessCitations` 다(그것은 «전수»다). */
  symbolLessSites: LineAnchorSymbolLessSite[];
  /** 허용 줄 범위. 현재 계약은 인용 줄 위아래 5줄이다. */
  tolerance: number;
}

/** 미판정 인용 «한 자리» — 문서 어느 줄에서 어느 소스를 가리켰나. */
export interface LineAnchorSymbolLessSite {
  sourcePath: string;
  citedLine: number;
  documentLine: number;
}

export interface LineAnchorSummary {
  checked: number;
  mismatches: number;
  unavailable: number;
  symbolLessCitations: number;
  tolerance: number;
}

export interface DocStaleness {
  path: string;
  superseded: boolean;
  supersededBy: string | null;
  staleScore: number;
  removedIdentifiers: string[];
  /**
   * ⭐⭐ **「어느 줄인가」** — 이름만으로는 ***「지금 있다고 «주장»한다」와 「은퇴했다고 «기록»한다」***를
   * 못 가른다. 둘은 처방이 반대다(앞의 것은 틀렸고 뒤의 것은 «맞다»).
   * 📏 실물: `BACKLOG-scheduler-retirement-followups` 는 죽은 이름을 «정당하게» 쓰는데
   *   도구가 다른 것들과 똑같이 「늙음」이라 불렀다. 줄과 문면이 있으면 사람이 «한 눈»에 가른다.
   * ⛔ 그리고 이것은 «판정»이 아니라 «판정문»이다 — `removedIdentifiers` 와 축 판정은 그대로다.
   */
  removedIdentifierSites: RemovedIdentifierSite[];
  brokenLinkCount: number;
  /** 경로 신호는 기본 판정과 hasAnySignal 합집합에 의도적으로 포함하지 않는다. */
  sourcePaths: SourcePathSignals;
  /** 줄 번호가 늙은 코드 인용은 line-anchors 축에서만 판정한다. */
  lineAnchors: LineAnchorSignals;
  branches: Record<IdentifierBranch, number>;
  /**
   * ⛔⭐⭐⭐ **이 필드는 «판정»이 아니라 «신호가 하나라도 있나»다**(리뷰 4R must-fix ①).
   *   종전 이름은 `stale` 이었고 네 신호의 «합집합»이었다 — 그래서 JSON 의 `stale` 이 791 을 뜻하는데
   *   사람 산출은 46 을 말해 ***같은 낱말이 두 수를 가리켰다***.
   *   ⇒ 판정은 «축»이 정하고(`DEFAULT_DOCS_STALE_AXIS`), 이 모듈은 «사실»만 낸다.
   */
  hasAnySignal: boolean;
}

/** Existing score becomes a stale signal at the documented curation threshold. */
export const STALE_SCORE_THRESHOLD = 60;

export function emptyBranchCounts(): Record<IdentifierBranch, number> {
  return { current: 0, 'recently-removed': 0, 'long-removed': 0, 'javascript-keyword': 0, 'document-label': 0, 'uppercase-status': 0, 'string-literal': 0, 'non-typescript-source': 0, unclassified: 0 };
}

export interface StalenessSummary {
  checked: number;
  /**
   * ⛔ **«판정»이 아니다** — 네 신호 중 «하나라도» 있는 문서 수(합집합).
   * ⭐ 「늙었다」의 판정은 `byAxis` 와 축이 정한다. 이 수를 「늙은 문서 수」로 인용하지 마라.
   */
  withAnySignal: number;
  /**
   * ⭐⭐⭐ **축마다 «따로» 센다** — 합집합 하나만 내면 「무엇 때문에 늙었나」를 못 가른다.
   * 📏 2026-08-12 실측: 합집합 791 인데 그 안의 축은 깨진 링크 628 · staleScore 107 ·
   *    superseded 41 · ***사라진 식별자 46*** 으로 «크기가 열 배 넘게» 벌어진다.
   *    ⇒ 합집합을 「늙은 문서 수」로 인용하면 코드-대조 축의 46 을 «못 찾는다».
   */
  byAxis: {
    /** ⭐ 이 도구의 «고유» 축 — 지금 없고 과거 인벤토리엔 있던 이름을 쓰는 문서 수 */
    removedIdentifiers: number;
    brokenLinks: number;
    supersededMarked: number;
    staleScoreOverThreshold: number;
  };
  /** 기존 네 축과 분리된 다섯째 부가 경로 신호 집계. */
  sourcePaths: SourcePathSummary;
  /** source-paths 축만을 위한 후보. 기존 documents 합집합 계약은 건드리지 않는다. */
  sourcePathDocuments: DocStaleness[];
  /** line-anchors 축만을 위한 줄 앵커 신호 집계. */
  lineAnchors: LineAnchorSummary;
  /** line-anchors 축만을 위한 후보. 기존 documents 합집합 계약은 건드리지 않는다. */
  lineAnchorDocuments: DocStaleness[];
  branches: Record<IdentifierBranch, number>;
  documents: DocStaleness[];
}

const JAVASCRIPT_KEYWORDS = new Set(['await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'undefined', 'var', 'void', 'while', 'with', 'yield']);

/**
 * ⛔⭐⭐⭐ **기본 비교 시점은 «커밋 수»가 아니라 «날짜»다** (2026-08-12 라이브 실측으로 고침).
 *   초판 기본값 `HEAD~1`/`HEAD~20` 은 이 저장소에서 ***세 시간 전***을 가리켰다(`HEAD~20` = 같은 날 12:25).
 *   ⇒ 그 창 안에서는 「사라진 이름」이 거의 없어 ***전 문서가 「현재」로 판정***됐다 —
 *     `내부 문서 `MANUAL-llm-tools`` 가 `buildPtyTools`(현재 소스 0곳)를 쓰는데도 `stale:false` 였다.
 *   ✅ 날짜 기준으로 바꾸니 같은 문서가 `removedIdentifiers:["buildPtyTools"]` · `stale:true` 로 «맞췄다».
 *   ⚠️ 저장소가 그 날짜보다 어리면 rev-list 가 빈 값을 준다 ⇒ 그때는 루트 커밋으로 내려간다
 *     (⛔ 빈 revision 을 `git archive` 에 넘기면 「없다」가 아니라 «throw» 다).
 */
export function defaultStalenessRevisions(repoRoot: string, nowMs = Date.now()): { recent: string; old: string } {
  const at = (daysAgo: number): string | null => {
    const before = new Date(nowMs - daysAgo * 86_400_000).toISOString().slice(0, 10);
    const out = execFileSync('git', ['rev-list', '-1', `--before=${before}`, 'HEAD'], { cwd: repoRoot, encoding: 'utf-8' }).trim(); // git-spawn-allow: Reads the revision immediately before the date boundary and does not modify repository state.
    return out || null;
  };
  const rootCommit = (): string =>
    execFileSync('git', ['rev-list', '--max-parents=0', '-1', 'HEAD'], { cwd: repoRoot, encoding: 'utf-8' }).trim(); // git-spawn-allow: Reads the repository root commit solely as a revision fallback and does not mutate repository state.
  const fallback = rootCommit();
  return { recent: at(RECENT_WINDOW_DAYS) ?? fallback, old: at(OLD_WINDOW_DAYS) ?? fallback };
}

/** 「최근에 사라졌다」와 「오래전에 사라졌다」를 가르는 창. ⛔ 커밋 수로 재면 이 저장소의 커밋 속도에 흔들린다. */
export const RECENT_WINDOW_DAYS = 30;
export const OLD_WINDOW_DAYS = 90;

export function sourceIdentifierInventoryAtRevision(repoRoot: string, revision: string): Set<string> {
  const dir = mkdtempSync(join(tmpdir(), 'elanous-doc-staleness-'));
  try {
    // ⛔⭐⭐⭐ **아카이브를 «부모 프로세스»로 들이지 않는다** — 이 저장소의 그것은 실측 ***255 MB*** 다
    //   (`git archive HEAD | wc -c` = 255,252,480 · 2026-08-27). 옛 문면은 그 255MB 를 통째로 Node
    //   버퍼로 받아 `tar` 의 «표준입력으로 밀었다». 그 자리가 두 시점 × 두 호출자로 «네 번» 돈다.
    // ⛔⭐⭐ 그리고 «프로세스 파이프로 바꾸는 것»은 답이 아니다 — 실측(2026-08-27):
    //   `Bun.spawn({ stdin: <다른 프로세스의 stdout> })` 은 OS 파이프가 아니라 ***부모를 거쳐 밀어 넣는다***.
    //   하류(tar)가 먼저 죽으면 그 밀어 넣기가 부모에서 ***처리되지 않은 `EPIPE`***(syscall: send)로 터진다
    //   — 한 판에서 43번 났다. 즉 파이프 판은 「메모리」는 줄여도 «부모 통과»와 «미처리 오류»를 남긴다.
    // ✅ 그래서 «파일»로 끊는다: 두 명령이 «순차»라 부모를 안 거치고, 실패 귀속도 경합 없이 갈린다
    //   (git 이 실패하면 tar 는 아예 안 돈다 · tar 가 실패하면 그 오류가 그대로 선다).
    const archivePath = join(dir, 'revision.tar');
    const tree = join(dir, 'tree');
    mkdirSync(tree);
    // ⛔⭐ `env` 를 «명시»한다 — 실측(2026-08-27): bun 의 `execFileSync` 는 `env` 를 안 주면 실행 파일을
    //   ***기동 시점의 `PATH`*** 로 찾는다. 즉 런타임에 바뀐 `PATH` 를 «안 본다» ⇒ 이 자리가 잴 수 없게 된다.
    execFileSync('git', ['archive', '--output', archivePath, revision], { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'], env: process.env }); // git-spawn-allow: Exports the revision archive only to the temporary directory for inventory reading and does not alter repository state.
    execFileSync('tar', ['-x', '-f', archivePath, '-C', tree], { stdio: ['ignore', 'ignore', 'inherit'], env: process.env });
    return sourceIdentifierInventory(tree);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function classifyIdentifier(
  identifier: string,
  inventories: { current: ReadonlySet<string>; recent: ReadonlySet<string>; old: ReadonlySet<string> },
  text = '',
): IdentifierClassification {
  if (inventories.current.has(identifier)) return { identifier, branch: 'current' };
  if (inventories.recent.has(identifier)) return { identifier, branch: 'recently-removed' };
  if (inventories.old.has(identifier)) return { identifier, branch: 'long-removed' };
  if (JAVASCRIPT_KEYWORDS.has(identifier)) return { identifier, branch: 'javascript-keyword' };
  if (new RegExp(`^#{1,6}\\s+.*\\b${identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'm').test(text)) return { identifier, branch: 'document-label' };
  if (/^[A-Z][A-Z0-9_]*$/.test(identifier)) return { identifier, branch: 'uppercase-status' };
  if (new RegExp(`['\"]${identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['\"]`).test(text)) return { identifier, branch: 'string-literal' };
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`(?:\\.(?:js|py|sh|rb|go|rs|java|kt|swift|c|cpp)\\b[^\\n]*\\b${escaped}\\b|\\b${escaped}\\b[^\\n]*\\.(?:js|py|sh|rb|go|rs|java|kt|swift|c|cpp)\\b)`).test(text)) return { identifier, branch: 'non-typescript-source' };
  return { identifier, branch: 'unclassified' };
}

function frontmatter(text: string): Record<string, string> {
  const block = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
  return Object.fromEntries([...block.matchAll(/^([\w-]+):\s*(.+)$/gm)].map((m) => [m[1]!, m[2]!.trim().replace(/^['"]|['"]$/g, '')]));
}

const SOURCE_PATH_TOKEN_PATTERN = /`([^`\n]+)`|(?:^|[\s(\["'])([^\s)\]}>"'`,;:]+)/gm;
const SOURCE_PATH_PATTERN = /^(?:(?:\.\.\/)+(?:src|scripts|apps)|(?:src|scripts|apps))\/[A-Za-z0-9_@./-]+\.(?:ts|tsx|js|jsx)$/;
const SOURCE_PATH_PLACEHOLDER_PATTERN = /[<{]((?:(?:\.\.\/)+(?:src|scripts|apps)|(?:src|scripts|apps))\/[A-Za-z0-9_@./-]+\.(?:ts|tsx|js|jsx))[>}]/g;
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'] as const;
const ESM_SPECIFIER_EXTENSIONS = ['.js', '.mjs', '.cjs'] as const;
const ESM_IMPLEMENTATION_EXTENSIONS = ['.ts', '.tsx'] as const;

function canonicalSourcePathToken(token: string): string | null {
  if (SOURCE_PATH_PATTERN.test(token)) return token;
  const separator = token.lastIndexOf(':');
  const path = separator === -1 ? '' : token.slice(0, separator);
  return SOURCE_PATH_PATTERN.test(path) ? path : null;
}

function sourcePathCandidates(text: string): Set<string> {
  const tokens = [...text.matchAll(SOURCE_PATH_TOKEN_PATTERN)]
    .map((match) => canonicalSourcePathToken(match[1] ?? match[2] ?? ''))
    .filter((token): token is string => token !== null);
  const placeholders = [...text.matchAll(SOURCE_PATH_PLACEHOLDER_PATTERN)].map((match) => match[0]);
  return new Set([...tokens, ...placeholders]);
}

function emptySourcePathSignals(): SourcePathSignals {
  return { checked: 0, missing: 0, extensionTypos: 0, excludedExamples: 0, resolvedFromDocument: 0, esmSpecifierResolved: 0 };
}

function isEsmSpecifierResolved(candidate: string, presentAlternativePaths: readonly string[]): boolean {
  if (!ESM_SPECIFIER_EXTENSIONS.some((extension) => candidate.endsWith(extension))) return false;
  return presentAlternativePaths.some((path) => ESM_IMPLEMENTATION_EXTENSIONS.some((extension) => path.endsWith(extension)));
}

function isExamplePath(path: string): boolean {
  return /(?:^|\/)(?:example|examples|fixture|fixtures|placeholder|your-project)(?:\/|$)|<[^>]+>|\{[^}]+\}/i.test(path);
}

function probeSourcePath(path: string): 'present' | 'missing' | 'unavailable' {
  try {
    return statSync(path).isFile() ? 'present' : 'missing';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR' ? 'missing' : 'unavailable';
  }
}

/** 후보는 `src/…`이면 저장소, `../src/…`이면 문서 디렉터리 한 기준점으로만 해석한다. 루트 밖 경로는 존재를 검사하지 않는다. */
export function assessSourcePaths(text: string, documentPath: string, repoRoot: string, probe: SourcePathProbe = probeSourcePath): SourcePathSignals {
  const signals = emptySourcePathSignals();
  const root = resolve(repoRoot);
  const candidates = sourcePathCandidates(text);
  const isInsideRoot = (path: string) => {
    const pathFromRoot = relative(root, path);
    return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !pathFromRoot.includes(`..${process.platform === 'win32' ? '\\' : '/'}`));
  };
  for (const candidate of candidates) {
    if (isExamplePath(candidate)) { signals.excludedExamples++; continue; }
    signals.checked++;
    const documentRelative = candidate.startsWith('../');
    const base = documentRelative ? join(root, dirname(documentPath)) : root;
    const resolved = resolve(base, candidate);
    if (!isInsideRoot(resolved)) { signals.missing++; continue; }
    const status = probe(resolved);
    if (status === 'unavailable') return { ...signals, status: 'unavailable', reason: `소스 경로 확인 불가 (${candidate})` };
    if (status === 'present') {
      if (documentRelative) signals.resolvedFromDocument++;
      continue;
    }
    const extension = SOURCE_EXTENSIONS.find((value) => candidate.endsWith(value));
    const basename = extension ? candidate.slice(0, -extension.length) : candidate;
    const alternatives = SOURCE_EXTENSIONS.filter((alternative) => alternative !== extension).map((alternative) => resolve(base, basename + alternative)).filter(isInsideRoot);
    const alternativeStatuses = alternatives.map(probe);
    if (alternativeStatuses.includes('unavailable')) return { ...signals, status: 'unavailable', reason: `소스 경로 확인 불가 (${candidate})` };
    const presentAlternatives = alternatives.filter((_, index) => alternativeStatuses[index] === 'present');
    if (presentAlternatives.length > 0) {
      if (isEsmSpecifierResolved(candidate, presentAlternatives)) { signals.esmSpecifierResolved++; continue; }
      signals.extensionTypos++;
      continue;
    }
    signals.missing++;
  }
  return signals;
}

export const LINE_ANCHOR_TOLERANCE = 5;
/** 미판정 «자리»를 보여 주는 상한. ⛔ 전수는 `symbolLessCitations` 가 갖는다 — 이 상한이 그 수를 «안 깎는다». */
export const SYMBOL_LESS_SITE_CAP = 20;
const LINE_ANCHOR_TOKEN_PATTERN = /(?:(?:\.\.\/)+(?:src|scripts|apps)|(?:src|scripts|apps))\/[A-Za-z0-9_@./-]+\.(?:ts|tsx|js|jsx):\d+/g;
const LINE_ANCHOR_BACKTICKED_SYMBOL_PATTERN = /`([A-Za-z_$][\w$]*)`/;
const LINE_ANCHOR_BACKTICKED_SYMBOL_SCAN_PATTERN = /`([A-Za-z_$][\w$]*)`/g;
const LINE_ANCHOR_SYMBOL_AFTER_PATTERN = /^\s*(?:[—–\-:：,;()]\s*)*([A-Za-z_$][\w$]*)\b/;
const LINE_ANCHOR_EXPLICIT_SYMBOL_AFTER_PATTERN = /^\s*[:：]\s*([A-Za-z_$][\w$]*)\b/;
const LINE_ANCHOR_SYMBOL_BEFORE_PATTERN = /(?:^|[\s(\[:：,;—–-])([A-Za-z_$][\w$]*)\s*(?:[)\]]\s*)?(?:[—–\-:：,;()]\s*)?$/;
const LINE_ANCHOR_LOWERCASE_WORDS = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'by', 'for', 'from', 'in', 'is', 'line', 'near', 'of', 'on', 'or', 'stale', 'the', 'to', 'was', 'with']);
const LINE_ANCHOR_TABLE_LABEL_WORDS = new Set(['CLI', 'TUI']);

function emptyLineAnchorSignals(): LineAnchorSignals {
  return { checked: 0, mismatches: [], unavailable: [], symbolLessCitations: 0, symbolLessSites: [], tolerance: LINE_ANCHOR_TOLERANCE };
}

function isIdentifierToken(token: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(token);
}

function isLikelyCodeSymbol(token: string, sourcePath: string): boolean {
  if (!isIdentifierToken(token)) return false;
  if (LINE_ANCHOR_LOWERCASE_WORDS.has(token)) return false;
  const excluded = new Set(sourcePath.split(/[/.\\-]+/).filter(Boolean));
  if (excluded.has(token)) return false;
  return /^[A-Z]/.test(token) || /[A-Z_$]/.test(token.slice(1)) || token.includes('_') || token.includes('$');
}

function uniqueLineAnchorSymbols(candidates: readonly string[], sourcePath: string, mode: 'explicit' | 'heuristic'): string[] {
  const accepts = mode === 'explicit'
    ? (token: string) => isIdentifierToken(token)
    : (token: string) => isLikelyCodeSymbol(token, sourcePath);
  return [...new Set(candidates.filter(accepts))];
}

function nearestLineAnchorSymbols(candidates: readonly { symbol: string | undefined; distance: number }[], sourcePath: string, mode: 'explicit' | 'heuristic'): string[] {
  const accepted = candidates
    .filter((candidate): candidate is { symbol: string; distance: number } => Boolean(candidate.symbol))
    .filter((candidate) => uniqueLineAnchorSymbols([candidate.symbol], sourcePath, mode).length === 1)
    .sort((left, right) => left.distance - right.distance);
  if (accepted.length === 0) return [];
  const nearestDistance = accepted[0]!.distance;
  return [...new Set(accepted.filter((candidate) => candidate.distance === nearestDistance).map((candidate) => candidate.symbol))];
}

function isLineAnchorTableLabelAfter(after: string, token: string, matchIndex: number): boolean {
  if (!LINE_ANCHOR_TABLE_LABEL_WORDS.has(token)) return false;
  const prefix = after.slice(0, matchIndex);
  const suffix = after.slice(matchIndex + token.length);
  return /^\s+$/.test(prefix) && (/^\s{2,}\S/.test(suffix) || /^\s+[^\x00-\x7F]/.test(suffix));
}

function lineAnchorSymbolCandidates(line: string, anchorStart: number, anchorEnd: number, sourcePath: string, nextAnchorStart: number | null, previousAnchorEnd: number | null): string[] {
  const afterEnd = nextAnchorStart ?? line.length;
  const beforeStart = previousAnchorEnd ?? 0;
  const after = line.slice(anchorEnd, afterEnd);
  const before = line.slice(beforeStart, anchorStart);
  const explicitAfterMatch = LINE_ANCHOR_BACKTICKED_SYMBOL_PATTERN.exec(after);
  const explicitBeforeMatches = [...before.matchAll(LINE_ANCHOR_BACKTICKED_SYMBOL_SCAN_PATTERN)];
  const explicitBeforeMatch = explicitBeforeMatches.at(-1);
  const explicitSymbols = nearestLineAnchorSymbols([
    { symbol: explicitAfterMatch?.[1], distance: explicitAfterMatch ? explicitAfterMatch.index : Number.POSITIVE_INFINITY },
    { symbol: explicitBeforeMatch?.[1], distance: explicitBeforeMatch ? anchorStart - (beforeStart + explicitBeforeMatch.index + explicitBeforeMatch[0].length) : Number.POSITIVE_INFINITY },
  ], sourcePath, 'explicit');
  if (explicitSymbols.length > 0) return explicitSymbols;
  const explicitColonAfterMatch = LINE_ANCHOR_EXPLICIT_SYMBOL_AFTER_PATTERN.exec(after);
  if (explicitColonAfterMatch?.[1]) return uniqueLineAnchorSymbols([explicitColonAfterMatch[1]], sourcePath, 'explicit');
  const heuristicAfterMatch = LINE_ANCHOR_SYMBOL_AFTER_PATTERN.exec(after);
  const heuristicBeforeMatch = LINE_ANCHOR_SYMBOL_BEFORE_PATTERN.exec(before);
  const heuristicAfterSymbol = heuristicAfterMatch?.[1];
  const heuristicAfterSymbolIndex = heuristicAfterMatch && heuristicAfterSymbol ? heuristicAfterMatch.index + heuristicAfterMatch[0].indexOf(heuristicAfterSymbol) : 0;
  return nearestLineAnchorSymbols([
    { symbol: heuristicAfterSymbol && !isLineAnchorTableLabelAfter(after, heuristicAfterSymbol, heuristicAfterSymbolIndex) ? heuristicAfterSymbol : undefined, distance: heuristicAfterMatch ? heuristicAfterMatch.index : Number.POSITIVE_INFINITY },
    { symbol: heuristicBeforeMatch?.[1], distance: heuristicBeforeMatch ? anchorStart - (beforeStart + heuristicBeforeMatch.index + heuristicBeforeMatch[0].length) : Number.POSITIVE_INFINITY },
  ], sourcePath, 'heuristic');
}

function lineHasSymbol(line: string, symbol: string): boolean {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`).test(line);
}

function lineAnchorDiagnostic(sourcePath: string, citedLine: number, symbol: string, reason: LineAnchorMismatch['reason'], tolerance: number): string {
  if (reason === 'missing-file') return `line-anchor mismatch: ${sourcePath}:${citedLine} ${symbol} — 파일 없음`;
  return `line-anchor mismatch: ${sourcePath}:${citedLine} ${symbol} — ±${tolerance}줄 안에 심볼 없음`;
}

function lineAnchorUnavailableDiagnostic(sourcePath: string, citedLine: number, symbol: string, reason: string): string {
  return `line-anchor unavailable: ${sourcePath}:${citedLine} ${symbol} — ${reason}`;
}

export function assessLineAnchors(text: string, documentPath: string, repoRoot: string, tolerance = LINE_ANCHOR_TOLERANCE): LineAnchorSignals {
  const signals = { ...emptyLineAnchorSignals(), tolerance };
  const root = resolve(repoRoot);
  const lines = text.split('\n');
  const isInsideRoot = (path: string) => {
    const pathFromRoot = relative(root, path);
    return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !pathFromRoot.includes(`..${process.platform === 'win32' ? '\\' : '/'}`));
  };
  const resolveSource = (sourcePath: string) => {
    const documentRelative = sourcePath.startsWith('../');
    const base = documentRelative ? join(root, dirname(documentPath)) : root;
    return resolve(base, sourcePath);
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;
    const anchors = [...line.matchAll(LINE_ANCHOR_TOKEN_PATTERN)].map((match) => ({ token: match[0], start: match.index ?? 0 }));
    for (let anchorIndex = 0; anchorIndex < anchors.length; anchorIndex++) {
      const anchor = anchors[anchorIndex]!;
      const separator = anchor.token.lastIndexOf(':');
      const sourcePath = anchor.token.slice(0, separator);
      const citedLine = Number.parseInt(anchor.token.slice(separator + 1), 10);
      const anchorEnd = anchor.start + anchor.token.length;
      const symbols = lineAnchorSymbolCandidates(line, anchor.start, anchorEnd, sourcePath, anchors[anchorIndex + 1]?.start ?? null, anchors[anchorIndex - 1] ? anchors[anchorIndex - 1]!.start + anchors[anchorIndex - 1]!.token.length : null);
      if (symbols.length !== 1) {
        signals.symbolLessCitations++;
        // ⛔ 전수는 위 카운터가 갖는다. 이 배열은 «보여 주기»용이라 상한을 건다.
        if (signals.symbolLessSites.length < SYMBOL_LESS_SITE_CAP) {
          signals.symbolLessSites.push({ sourcePath, citedLine, documentLine: lineIndex + 1 });
        }
        continue;
      }
      const symbol = symbols[0]!;
      signals.checked++;
      const resolved = resolveSource(sourcePath);
      if (!isInsideRoot(resolved)) {
        const reason = 'missing-file' as const;
        signals.mismatches.push({ sourcePath, citedLine, symbol, documentLine: lineIndex + 1, reason, diagnostic: lineAnchorDiagnostic(sourcePath, citedLine, symbol, reason, tolerance) });
        continue;
      }
      let sourceLines: string[];
      try {
        sourceLines = readFileSync(resolved, 'utf-8').split('\n');
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') {
          const reason = 'missing-file' as const;
          signals.mismatches.push({ sourcePath, citedLine, symbol, documentLine: lineIndex + 1, reason, diagnostic: lineAnchorDiagnostic(sourcePath, citedLine, symbol, reason, tolerance) });
        } else {
          const reason = `파일 읽기 실패 (${code ?? 'unknown'})`;
          signals.unavailable.push({ sourcePath, citedLine, symbol, documentLine: lineIndex + 1, reason, diagnostic: lineAnchorUnavailableDiagnostic(sourcePath, citedLine, symbol, reason) });
        }
        continue;
      }
      const from = Math.max(1, citedLine - tolerance);
      const to = Math.min(sourceLines.length, citedLine + tolerance);
      let found = false;
      for (let sourceLine = from; sourceLine <= to; sourceLine++) {
        if (lineHasSymbol(sourceLines[sourceLine - 1] ?? '', symbol)) { found = true; break; }
      }
      if (!found) {
        const reason = 'symbol-outside-tolerance' as const;
        signals.mismatches.push({ sourcePath, citedLine, symbol, documentLine: lineIndex + 1, reason, diagnostic: lineAnchorDiagnostic(sourcePath, citedLine, symbol, reason, tolerance) });
      }
    }
  }
  return signals;
}

export function assessDocStaleness(entry: DocEntry, text: string, context: {
  repoRoot: string;
  inventories: { current: ReadonlySet<string>; recent: ReadonlySet<string>; old: ReadonlySet<string> };
  nowMs?: number;
  vaultFiles?: readonly string[];
  sourcePathProbe?: SourcePathProbe;
}): DocStaleness {
  const meta = frontmatter(text);
  const classifications = [...inlineCodeIdentifiers(text)].map((identifier) => classifyIdentifier(identifier, context.inventories, text));
  const branches = emptyBranchCounts();
  for (const { branch } of classifications) branches[branch]++;
  const removedIdentifiers = classifications.filter(({ branch }) => branch === 'recently-removed' || branch === 'long-removed').map(({ identifier }) => identifier);
  const sourceRel = entry.path.replaceAll('\\', '/');
  const links = lintDocLinks(sourceRel, text, {
    fileExists: (path) => existsSync(join(context.repoRoot, path)),
    readText: (path) => { try { return readFileSync(join(context.repoRoot, path), 'utf-8'); } catch { return null; } },
    vaultFiles: context.vaultFiles,
  });
  const superseded = meta.status === 'superseded';
  const supersededBy = meta.superseded_by ?? null;
  const score = staleScore(entry, context.nowMs ?? Date.now());
  return {
    path: entry.path,
    superseded,
    supersededBy,
    staleScore: score,
    removedIdentifiers,
    removedIdentifierSites: locateRemovedIdentifiers(text, removedIdentifiers),
    brokenLinkCount: links.length,
    sourcePaths: assessSourcePaths(text, entry.path, context.repoRoot, context.sourcePathProbe),
    lineAnchors: assessLineAnchors(text, entry.path, context.repoRoot),
    branches,
    hasAnySignal: superseded || score >= STALE_SCORE_THRESHOLD || removedIdentifiers.length > 0 || links.length > 0,
  };
}

export function assessDocsStaleness(repoRoot: string, revisions?: { recent: string; old: string }, sourcePathProbe?: SourcePathProbe): StalenessSummary {
  const root = resolve(repoRoot);
  const docsDir = join(root, 'docs');
  const entries = scanDocs(docsDir);
  const revs = revisions ?? defaultStalenessRevisions(root);
  const inventories = { current: sourceIdentifierInventory(root), recent: sourceIdentifierInventoryAtRevision(root, revs.recent), old: sourceIdentifierInventoryAtRevision(root, revs.old) };
  const branches = emptyBranchCounts();
  const vaultFiles = entries.map((entry) => entry.path);
  const documents = entries.map((entry) => {
    const text = readFileSync(join(root, entry.path), 'utf-8');
    const document = assessDocStaleness(entry, text, { repoRoot: root, inventories, vaultFiles, sourcePathProbe });
    for (const branch of Object.keys(branches) as IdentifierBranch[]) branches[branch] += document.branches[branch];
    return document;
  });
  const withSignal = documents.filter((document) => document.hasAnySignal);
  const byAxis = {
    removedIdentifiers: documents.filter((document) => document.removedIdentifiers.length > 0).length,
    brokenLinks: documents.filter((document) => document.brokenLinkCount > 0).length,
    supersededMarked: documents.filter((document) => document.superseded).length,
    staleScoreOverThreshold: documents.filter((document) => document.staleScore >= STALE_SCORE_THRESHOLD).length,
  };
  const unavailable = documents.find((document) => document.sourcePaths.status === 'unavailable');
  const sourcePaths: SourcePathSummary = {
    checked: documents.reduce((total, document) => total + document.sourcePaths.checked, 0),
    missing: documents.reduce((total, document) => total + document.sourcePaths.missing, 0),
    extensionTypos: documents.reduce((total, document) => total + document.sourcePaths.extensionTypos, 0),
    excludedExamples: documents.reduce((total, document) => total + document.sourcePaths.excludedExamples, 0),
    resolvedFromDocument: documents.reduce((total, document) => total + document.sourcePaths.resolvedFromDocument, 0),
    esmSpecifierResolved: documents.reduce((total, document) => total + document.sourcePaths.esmSpecifierResolved, 0),
    ...(unavailable ? { status: 'unavailable', reason: unavailable.sourcePaths.reason } : { status: 'ok' }),
  };
  const lineAnchors: LineAnchorSummary = {
    checked: documents.reduce((total, document) => total + document.lineAnchors.checked, 0),
    mismatches: documents.reduce((total, document) => total + document.lineAnchors.mismatches.length, 0),
    unavailable: documents.reduce((total, document) => total + document.lineAnchors.unavailable.length, 0),
    symbolLessCitations: documents.reduce((total, document) => total + document.lineAnchors.symbolLessCitations, 0),
    tolerance: LINE_ANCHOR_TOLERANCE,
  };
  return {
    checked: documents.length,
    withAnySignal: withSignal.length,
    byAxis,
    sourcePaths,
    sourcePathDocuments: documents.filter((document) => document.sourcePaths.missing > 0 || document.sourcePaths.extensionTypos > 0),
    lineAnchors,
    lineAnchorDocuments: documents.filter((document) => document.lineAnchors.mismatches.length > 0),
    branches,
    documents: withSignal,
  };
}

/**
 * ⛔⭐ **판정을 «인자»로 받는다** — 이 함수가 스스로 「늙음」을 정하면 축 계약이 두 곳에 생긴다(4R must-fix ①).
 *   부르는 쪽(CLI)이 축으로 판정하고, 여기는 그 판정과 «사실»을 문장으로 만든다.
 */
export function formatDocStaleness(document: DocStaleness, stale: boolean): string {
  const source = document.sourcePaths;
  const lineAnchors = document.lineAnchors;
  const signals = [document.superseded ? `superseded${document.supersededBy ? ` → ${document.supersededBy}` : ''}` : null, document.removedIdentifiers.length ? `사라진 식별자: ${document.removedIdentifiers.join(', ')}` : null, document.brokenLinkCount ? `깨진 링크 ${document.brokenLinkCount}건` : null, source.status === 'unavailable' ? `소스 경로 못 셈: ${source.reason ?? '경로 평가 결과 없음'}` : null, source.missing ? `없는 소스 경로 ${source.missing}건` : null, source.extensionTypos ? `확장자 오기 ${source.extensionTypos}건` : null, lineAnchors.mismatches.length ? `늙은 줄 앵커 ${lineAnchors.mismatches.length}건` : null, lineAnchors.unavailable.length ? `줄 앵커 못 셈 ${lineAnchors.unavailable.length}건` : null].filter(Boolean);
  // ⛔⭐⭐ 「못 쟀다」를 «반드시» 같이 낸다 — 「현재」로만 읽히면 이 자가 「안 늙었다」를 뜻하게 된다.
  //   📏 2026-09-02 실물: 이 저장소 전수에서 판정한 인용 2,033 ↔ ***심볼이 없어 판정 못 한 인용 6,828***(77%).
  //   그 6,828 안에 「10일간 늙어서 사람을 실제로 오판시킨 줄」이 있었고, 화면은 그 문서를 「현재」라 불렀다.
  //   ⇒ 「측정 불가」는 「없다」가 아니다 — 자는 자기가 «못 본 것»을 말해야 한다.
  const unjudged = lineAnchors.symbolLessCitations
    ? `줄 앵커 미판정 ${lineAnchors.symbolLessCitations}건(±5줄 안에 심볼을 못 찾아 «안 쟀다»)`
    : null;
  const facts = [...signals, unjudged].filter((fact): fact is string => fact !== null);
  return `${document.path}: ${stale ? '늙음' : '현재'} (staleScore ${document.staleScore})${facts.length ? ` — ${facts.join(' · ')}` : ''}`;
}

/** 삭제 diff의 식별자는 부분 문자열이 아닌 해당 언어의 토큰 경계로만 판별한다. */
export function isRemovedIdentifierLine(identifier: string, patchLine: string): boolean {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`).test(patchLine);
}

/** 읽기 전용 `git log -S` 후보 중 실제 삭제 diff를 낸 가장 최근 커밋만 채택한다. */
export function findRemovedIdentifierHistory(repoRoot: string, identifiers: readonly string[]): RemovedIdentifierHistory[] {
  return identifiers.map((identifier) => {
    try {
      const output = execFileSync(/* git-spawn-allow: Searches history for identifier-changing commits as read-only evidence and does not change repository state. */ 'git', ['log', '--format=%h%x09%s', '-n', '20', '-S', identifier, '--', 'src', 'scripts'], {
        cwd: repoRoot,
        encoding: 'utf-8',
        maxBuffer: 2_000_000,
      });
      for (const line of output.split('\n').filter(Boolean)) {
        const [shortId, title] = line.split('\t', 2);
        if (!shortId || title === undefined) continue;
        const patch = execFileSync(/* git-spawn-allow: Reads the candidate commit diff to confirm a deletion and leaves repository state unchanged. */ 'git', ['show', '--format=', '--unified=0', shortId, '--', 'src', 'scripts'], {
          cwd: repoRoot,
          encoding: 'utf-8',
          maxBuffer: 2_000_000,
        });
        if (patch.split('\n').some((patchLine) => patchLine.startsWith('-') && !patchLine.startsWith('---') && isRemovedIdentifierLine(identifier, patchLine))) {
          return { identifier, status: 'found' as const, commit: { shortId, title } };
        }
      }
    } catch { /* fail-soft: history is optional explanation, not the stale decision */ }
    return { identifier, status: 'not-found' as const };
  });
}

export function enrichDocStalenessHistory(document: DocStaleness, repoRoot: string, findHistory = findRemovedIdentifierHistory): DocStaleness & DocStalenessHistory {
  return { ...document, removedIdentifierHistory: findHistory(repoRoot, document.removedIdentifiers) };
}

export function formatRemovedIdentifierHistory(history: readonly RemovedIdentifierHistory[]): string[] {
  return history.map((item) => item.status === 'found'
    ? `    ${item.identifier} → ${item.commit!.shortId} ${item.commit!.title}`
    : `    ${item.identifier} → 못 찾았다`);
}

/** 단건 판정 세 갈래 — 후보에 있음 / 저장소에 없음 / 실재하나 사정거리 밖. */
export type OneDocStalenessResult =
  | { outcome: 'assessed'; document: DocStaleness }
  | { outcome: 'missing' }
  | { outcome: 'out-of-scope' };

/** 상시주입 루트 문서. 전수 스캔(`assessDocsStaleness`)은 docs/ 만 본다. */
const ALWAYS_INJECTED_ROOT_DOCS = ['CLAUDE.md', 'AGENTS.md'] as const;

function alwaysInjectedRootDocEntries(root: string): DocEntry[] {
  let names: string[];
  try { names = readdirSync(root); } catch { return []; }
  const skipDirs: string[] = [];
  for (const name of names) {
    try { if (statSync(join(root, name)).isDirectory()) skipDirs.push(name); } catch { /* */ }
  }
  return scanDocs(root, { skipDirs })
    .filter((entry) => (ALWAYS_INJECTED_ROOT_DOCS as readonly string[]).includes(entry.filename))
    .map((entry) => ({ ...entry, path: entry.filename, subdir: '' }));
}

export function assessOneDocStaleness(repoRoot: string, path: string, revisions?: { recent: string; old: string }): OneDocStalenessResult {
  const root = resolve(repoRoot);
  const full = resolve(root, path);
  const inside = full === root || full.startsWith(`${root}/`);
  if (!inside) return { outcome: 'missing' };
  const docsEntries = scanDocs(join(root, 'docs'));
  const candidates = [...docsEntries, ...alwaysInjectedRootDocEntries(root)];
  const entry = candidates.find((candidate) => resolve(root, candidate.path) === full);
  if (!entry) return { outcome: existsSync(full) ? 'out-of-scope' : 'missing' };
  const revs = revisions ?? defaultStalenessRevisions(root);
  const inventories = { current: sourceIdentifierInventory(root), recent: sourceIdentifierInventoryAtRevision(root, revs.recent), old: sourceIdentifierInventoryAtRevision(root, revs.old) };
  return {
    outcome: 'assessed',
    document: assessDocStaleness(entry, readFileSync(full, 'utf-8'), { repoRoot: root, inventories, vaultFiles: docsEntries.map((candidate) => candidate.path) }),
  };
}
