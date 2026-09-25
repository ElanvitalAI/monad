/**
 * Swallowed-exception ruler — counts empty and comment-only catch blocks.
 *
 * This script does not rewrite catch sites. Classification is conservative:
 * a catch whose *inner* comments state a reason is not `silent` (OBS-T359).
 * Leading/try comments and string/comment tokens in the try body are ignored.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, win32 } from 'node:path';
import ts from 'typescript';

const repo = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.git', '.monad-test', '.next', 'dist', 'coverage', 'build']);
const SOURCE_FILE = /\.([cm]?[jt]sx?)$/;

export const INVENTORY_REFRESH_COMMAND = 'bun scripts/audit-swallowed-exceptions.ts';
export const BASELINE_RELATIVE_PATH = 'test/swallowed-exceptions-baseline.txt';
export const MISSING_BASELINE_STATUS = 2;
export const NEW_SILENT_STATUS = 1;
export const CATEGORIES = ['observability', 'cleanup', 'silent'] as const;

export type SwallowedCategory = (typeof CATEGORIES)[number];

export type SwallowedFinding = {
  file: string;
  line: number;
  column: number;
  category: SwallowedCategory;
};

export type GitIgnoreScanStatus = 'applied' | 'fallback';

export type SwallowedReport = {
  findings: SwallowedFinding[];
  counts: Record<SwallowedCategory, number>;
  /** Absent means the scan status was never recorded — do not report it as applied. */
  gitIgnoreScan?: GitIgnoreScanStatus;
};

export type SwallowedAuditIo = {
  args?: string[];
  report?: SwallowedReport;
  loadBaseline?: () => Set<string> | null;
  log?: (message: string) => void;
  error?: (message: string) => void;
  root?: string;
};

const OBSERVABILITY_DOTTED = new Set([
  'console.log',
  'console.debug',
  'console.info',
  'console.warn',
  'console.error',
  'debug.log',
  'debug.flush',
]);
const OBSERVABILITY_PARTS = new Set(['logger', 'telemetry', 'observe']);
const CLEANUP_NAMES = new Set([
  'close',
  'rollback',
  'unlink',
  'rmSync',
  'rmdir',
  'dispose',
  'destroy',
  'abort',
  'cleanup',
  'release',
  'unref',
  'cancel',
  'disconnect',
  'terminate',
]);
const TRACKER_PREFIX = /^(?:TODO|FIXME|XXX|HACK|NOTE|REVIEW|BUG)\b/i;

export function findingKey(finding: Pick<SwallowedFinding, 'file' | 'line' | 'column'>): string {
  return `${finding.file}:${finding.line}:${finding.column}`;
}

export function countsOf(findings: readonly SwallowedFinding[]): Record<SwallowedCategory, number> {
  const counts: Record<SwallowedCategory, number> = { observability: 0, cleanup: 0, silent: 0 };
  for (const finding of findings) counts[finding.category]++;
  return counts;
}

export function buildReport(findings: SwallowedFinding[]): SwallowedReport {
  const sorted = [...findings].sort(
    (left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.column - right.column,
  );
  return { findings: sorted, counts: countsOf(sorted) };
}

function extractCommentBodies(text: string): string[] {
  const bodies: string[] = [];
  for (const match of text.matchAll(/\/\*([\s\S]*?)\*\//g)) bodies.push(match[1] ?? '');
  for (const match of text.matchAll(/(^|[^:])\/\/(.*)$/gm)) bodies.push(match[2] ?? '');
  return bodies;
}

function normalizeCommentBody(body: string): string {
  return body.replace(/^\s*\*/gm, ' ').replace(/\s+/g, ' ').trim();
}

export function hasReasonComment(catchInner: string): boolean {
  return extractCommentBodies(catchInner).some((body) => {
    const normalized = normalizeCommentBody(body);
    if (!normalized || TRACKER_PREFIX.test(normalized)) return false;
    return /[A-Za-z가-힣]/.test(normalized);
  });
}

function calleeParts(expression: ts.Expression): string[] {
  const parts: string[] = [];
  let current: ts.Expression = expression;
  while (true) {
    if (ts.isIdentifier(current)) {
      parts.unshift(current.text);
      break;
    }
    if (ts.isPropertyAccessExpression(current) && ts.isIdentifier(current.name)) {
      parts.unshift(current.name.text);
      current = current.expression;
      continue;
    }
    if (ts.isElementAccessExpression(current) && ts.isStringLiteral(current.argumentExpression)) {
      parts.unshift(current.argumentExpression.text);
      current = current.expression;
      continue;
    }
    break;
  }
  return parts;
}

function signalOfCall(expression: ts.Expression): SwallowedCategory | null {
  const parts = calleeParts(expression);
  if (parts.length === 0) return null;
  const dotted = parts.join('.');
  const last = parts[parts.length - 1]!;
  if (OBSERVABILITY_DOTTED.has(dotted) || parts.some((part) => OBSERVABILITY_PARTS.has(part))) {
    return 'observability';
  }
  if (CLEANUP_NAMES.has(last)) return 'cleanup';
  return null;
}

function collectCallSignals(root: ts.Node): { observability: boolean; cleanup: boolean } {
  let observability = false;
  let cleanup = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const signal = signalOfCall(node.expression);
      if (signal === 'observability') observability = true;
      if (signal === 'cleanup') cleanup = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return { observability, cleanup };
}

function classifyFromSignals(
  signals: { observability: boolean; cleanup: boolean },
  catchInner: string,
): SwallowedCategory {
  if (hasReasonComment(catchInner)) {
    if (signals.observability) return 'observability';
    if (signals.cleanup) return 'cleanup';
    return 'observability';
  }
  if (signals.observability) return 'observability';
  if (signals.cleanup) return 'cleanup';
  return 'silent';
}

export function classifySwallowedCatch(input: {
  tryText: string;
  catchInner: string;
}): SwallowedCategory {
  const source = ts.createSourceFile(
    'try-snippet.ts',
    `function __try() {\n${input.tryText}\n}`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return classifyFromSignals(collectCallSignals(source), input.catchInner);
}

function positionOf(source: ts.SourceFile, node: ts.Node): { line: number; column: number } {
  const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { line: pos.line + 1, column: pos.character + 1 };
}

function scriptKindFor(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx') || file.endsWith('.jsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function catchInnerText(source: ts.SourceFile, block: ts.Block): string {
  return source.text.slice(block.getStart(source) + 1, block.end - 1);
}

export function scanSwallowedExceptions(sourceText: string, file = 'snippet.ts'): SwallowedFinding[] {
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, scriptKindFor(file));
  const findings: SwallowedFinding[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCatchClause(node) && node.block.statements.length === 0) {
      const tryStatement = node.parent;
      const signals = ts.isTryStatement(tryStatement)
        ? collectCallSignals(tryStatement.tryBlock)
        : { observability: false, cleanup: false };
      const inner = catchInnerText(source, node.block);
      const { line, column } = positionOf(source, node);
      findings.push({
        file,
        line,
        column,
        category: classifyFromSignals(signals, inner),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      walk(join(dir, entry.name), out);
      continue;
    }
    if (SOURCE_FILE.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(join(dir, entry.name));
  }
}

function gitSpawnEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
}

function isSkippedRelativePath(rel: string): boolean {
  const dirs = rel.split(/[\\/]/).slice(0, -1);
  return dirs.some((part) => SKIP_DIRS.has(part) || part.startsWith('.'));
}

/** `.git` 파일의 `gitdir:` 값을 worktree root 기준으로 «푼다».
 *  ⛔ 순수 함수로 뺀 이유: 실제 조건(Windows 절대경로)을 이 기계에서 «만들 수 없다» —
 *  macOS/Linux 의 gitdir 는 언제나 `/` 로 시작해서 옛 코드(`startsWith('/')`)도 통과한다.
 *  ⇒ 그러면 반증이 «조용»해서 수리가 무는지 알 수 없다. 그래서 «모양»으로 문다. */
export function resolveGitDirPath(root: string, gitdir: string): string {
  // ⛔⭐ `path.isAbsolute` 는 ***플랫폼별***이다 — POSIX 런타임에서는 `C:\\repo\\…` 를
  //   절대경로로 «안» 본다. 그래서 win32 규칙도 «같이» 본다.
  //   🔑 왜 안전한가: 이 값은 git 이 쓴 `.git` 파일의 `gitdir:` 뿐이고,
  //     `C:\\…` 모양은 Windows git 만 만든다. POSIX 경로가 그 모양일 수 없다.
  //   🩸 그리고 이게 없으면 ***이 수리를 POSIX 에서 «시험할 수 없다»*** —
  //     옛 코드(`startsWith('/')`)와 결과가 같아져 반증이 조용해진다(실측으로 확인했다).
  return isAbsolute(gitdir) || win32.isAbsolute(gitdir) ? gitdir : join(root, gitdir);
}

function resolveGitDir(root: string): string | null {
  const gitPath = join(root, '.git');
  if (!existsSync(gitPath)) return null;
  try {
    const stat = statSync(gitPath);
    if (stat.isDirectory()) return gitPath;
    if (!stat.isFile()) return null;
    const match = readFileSync(gitPath, 'utf8').match(/^gitdir:\s*(.+)$/m);
    const gitdir = match?.[1]?.trim();
    if (!gitdir) return null;
    // ⛔ `startsWith('/')` 로는 Windows 절대경로(`C:\\…` · `C:/…`)를 «못 본다» —
    //    그러면 linked worktree 의 gitdir 가 root 에 잘못 결합돼 조회가 실패하고,
    //    조용히 fallback 으로 떨어져 ***빌드 산출물을 다시 훑는다***(이 판이 고치려던 그 상태).
    //    📌 이 저장소는 linked worktree 를 «상시» 쓴다 — 하니스 자식이 전부 그 형태다.
    return resolveGitDirPath(root, gitdir);
  } catch {
    return null;
  }
}

function isSourceFileName(name: string): boolean {
  return SOURCE_FILE.test(name) && !name.endsWith('.d.ts');
}

/**
 * One git process: tracked + untracked-non-ignored paths.
 * Returns null when this root is not its own git work tree (missing `.git`,
 * spawn failure, or a parent repository answering for a `.git`-less copy).
 */
function listGitVisibleSourceFiles(root: string): string[] | null {
  const gitDir = resolveGitDir(root);
  if (!gitDir) return null;
  const result = spawnSync(
    'git',
    ['--git-dir', gitDir, '--work-tree', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
      env: gitSpawnEnv(),
    },
  );
  if (result.error || result.status !== 0 || result.stdout === undefined) return null;
  const files: string[] = [];
  for (const rel of result.stdout.split('\0')) {
    if (!rel || isSkippedRelativePath(rel) || !isSourceFileName(basename(rel))) continue;
    const abs = join(root, rel);
    if (!existsSync(abs)) continue;
    files.push(abs);
  }
  return files;
}

export function describeGitIgnoreScan(status: SwallowedReport['gitIgnoreScan']): string {
  if (status === 'applied') return 'git-ignore: applied';
  if (status === 'fallback') return 'git-ignore: fallback — SKIP_DIRS (git ignore rules unavailable)';
  return 'git-ignore: unknown';
}

export function auditSwallowedExceptions(root = repo): SwallowedReport {
  const gitFiles = listGitVisibleSourceFiles(root);
  const files: string[] = [];
  const gitIgnoreScan: GitIgnoreScanStatus = gitFiles ? 'applied' : 'fallback';
  if (gitFiles) files.push(...gitFiles);
  else walk(root, files);
  const findings: SwallowedFinding[] = [];
  for (const file of files) {
    const relativeFile = relative(root, file);
    findings.push(...scanSwallowedExceptions(readFileSync(file, 'utf8'), relativeFile));
  }
  return { ...buildReport(findings), gitIgnoreScan };
}

export function renderSwallowedAudit(report: SwallowedReport): string {
  const lines = [
    'swallowed-exceptions',
    `refresh: ${INVENTORY_REFRESH_COMMAND}`,
    describeGitIgnoreScan(report.gitIgnoreScan),
    '',
  ];
  for (const category of CATEGORIES) {
    const grouped = report.findings.filter((finding) => finding.category === category);
    lines.push(`${category}: ${report.counts[category]}`);
    for (const finding of grouped) lines.push(`  ${findingKey(finding)}`);
    if (grouped.length === 0) lines.push('  (none)');
    lines.push('');
  }
  return lines.join('\n');
}

export function checkSwallowedExceptions(
  silentKeys: readonly string[],
  baseline: Set<string> | null,
  baselinePath = BASELINE_RELATIVE_PATH,
): { exitCode: number; diagnostic: string } {
  if (baseline === null) {
    return {
      exitCode: MISSING_BASELINE_STATUS,
      diagnostic: `[swallowed-exceptions] missing-baseline: ${baselinePath} does not exist`,
    };
  }
  const novel = silentKeys.filter((key) => !baseline.has(key));
  if (novel.length > 0) {
    return {
      exitCode: NEW_SILENT_STATUS,
      diagnostic: [`[swallowed-exceptions] new-silent: ${novel.length}`, ...novel.map((key) => `  ${key}`)].join('\n'),
    };
  }
  return {
    exitCode: 0,
    diagnostic: `[swallowed-exceptions] PASS — no new silent findings (baseline ${baseline.size})`,
  };
}

function defaultBaselinePath(root: string): string {
  return join(root, BASELINE_RELATIVE_PATH);
}

function loadBaselineFile(root: string): Set<string> | null {
  const path = defaultBaselinePath(root);
  if (!existsSync(path)) return null;
  return new Set(
    readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#')),
  );
}

export function serializeSwallowedBaseline(report: SwallowedReport): string {
  const keys = buildReport(report.findings)
    .findings.filter((finding) => finding.category === 'silent')
    .map(findingKey);
  return [
    '# Committed baseline for swallowed-exception silent locations.',
    '# New silent locations fail `bun scripts/audit-swallowed-exceptions.ts --check`; disappeared locations are allowed.',
    '# Refresh:',
    `# ${INVENTORY_REFRESH_COMMAND}`,
    '',
    ...keys,
    '',
  ].join('\n');
}

export function writeSwallowedBaseline(report: SwallowedReport, root = repo): void {
  const content = serializeSwallowedBaseline(report);
  const targetBaselinePath = defaultBaselinePath(root);
  mkdirSync(dirname(targetBaselinePath), { recursive: true });
  const temporaryBaselinePath = join(dirname(targetBaselinePath), `.${basename(targetBaselinePath)}.${process.pid}.tmp`);
  try {
    writeFileSync(temporaryBaselinePath, content);
    renameSync(temporaryBaselinePath, targetBaselinePath);
  } catch (error) {
    if (existsSync(temporaryBaselinePath)) unlinkSync(temporaryBaselinePath);
    throw error;
  }
}

export function main(args = process.argv.slice(2), io: SwallowedAuditIo = {}): number {
  const argv = io.args ?? args;
  const log = io.log ?? console.log;
  const error = io.error ?? console.error;
  const root = io.root ?? repo;
  const report = io.report ?? auditSwallowedExceptions(root);
  if (argv.includes('--check')) {
    const baseline = (io.loadBaseline ?? (() => loadBaselineFile(root)))();
    const silentKeys = report.findings.filter((finding) => finding.category === 'silent').map(findingKey);
    const result = checkSwallowedExceptions(silentKeys, baseline, BASELINE_RELATIVE_PATH);
    const write = result.exitCode === 0 ? log : error;
    write(result.diagnostic);
    write(describeGitIgnoreScan(report.gitIgnoreScan));
    return result.exitCode;
  }
  writeSwallowedBaseline(report, root);
  log(renderSwallowedAudit(report));
  log(`[swallowed-exceptions] wrote ${report.counts.silent} silent keys to ${BASELINE_RELATIVE_PATH}.`);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
