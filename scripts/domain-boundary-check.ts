import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parse as parseYaml } from 'yaml';

export type DomainBoundaryVerdict = 'core' | 'company-only' | 'unknown';

export type DomainBoundaryRecord = {
  path: string;
  verdict: DomainBoundaryVerdict;
  evidence: string;
};

export type DomainBoundarySummary = {
  core: number;
  'company-only': number;
  unknown: number;
  total: number;
};

export type DomainBoundaryError = {
  path: string;
  reason: string;
};

export type DomainBoundaryResult = {
  records: DomainBoundaryRecord[];
  summary: DomainBoundarySummary;
  errors: DomainBoundaryError[];
};

export type DomainBoundaryConfirmation = {
  verdict: 'core' | 'company-only';
  evidence: string;
};

export type DomainBoundaryConfirmations = Record<string, DomainBoundaryConfirmation>;

export type DomainBoundaryOptions = {
  root?: string;
  resourceMapPath?: string;
  confirmationsPath?: string;
  confirmations?: DomainBoundaryConfirmations;
  readFile?: (path: string) => string;
  listDirectory?: (path: string) => string[];
  pathExists?: (path: string) => boolean;
  isDirectory?: (path: string) => boolean;
};

export type DomainBoundaryCliOptions = DomainBoundaryOptions & {
  argv?: string[];
  out?: { log: (line: string) => void };
  setExitCode?: (code: number) => void;
};

export const NO_RULE_MATCHED = 'no-rule-matched';
export const HUMAN_CONFIRMED = 'human-confirmed';

export function formatUnreadableEvidence(reason: string): string {
  return `unreadable: ${reason}`;
}

/**
 * 가설 — 파일 이름 접두는 증거가 아니다.
 * `signal-dedup.ts` 는 접두가 signal 이어도 `XAI_API_KEY` 를 쓰고,
 * `taste-*` 는 이름만으로는 어느 쪽인지 알 수 없다.
 */
export const FINANCIAL_PREFIX_HYPOTHESIS = [
  'trade',
  'backtest',
  'signal',
  'market',
  'finance',
  'regime',
] as const;

const CORE_ZONES = [
  'src/cli',
  'src/nexus',
  'src/agent',
  'src/harness',
  'src/self-dev',
  'src/self-implement',
  'src/boot',
  'src/mss',
  'src/expression',
] as const;

type ImportEvidence = {
  financialImport?: string;
  coreImporter?: string;
};

type FsSeams = {
  readFile: (path: string) => string;
  listDirectory: (path: string) => string[];
  pathExists: (path: string) => boolean;
  isDirectory: (path: string) => boolean;
};

type FileReadCache = {
  readRelative: (relativePath: string) => string | undefined;
  failureReasonOf: (relativePath: string) => string | undefined;
};

/**
 * 사람이 건별로 확정한 판정의 누적 저장 위치.
 * 카탈로그·도메인 파일은 고치지 않는다. 파일이 없으면 확정은 0건이다.
 */
export const DEFAULT_CONFIRMATIONS_PATH = 'scripts/domain-boundary-confirmations.json';

const SCRIPT_REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOMAINS_RELATIVE = 'src/domains';

function posixPath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function failureReason(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error) || 'unknown read failure';
}

function observationError(path: string, error: unknown): DomainBoundaryError {
  return { path, reason: failureReason(error) };
}

function describeCatalogValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function namesFromResourceMap(contents: string): Set<string> {
  const document = parseYaml(contents) as { resources?: unknown } | null;
  const resources =
    document !== null && typeof document === 'object' && !Array.isArray(document)
      ? document.resources
      : undefined;
  if (!Array.isArray(resources)) {
    throw new Error(`resources must be an array (got ${describeCatalogValue(resources)})`);
  }
  const names = new Set<string>();
  for (const resource of resources) {
    if (typeof resource !== 'object' || resource === null) continue;
    const env = (resource as { env?: unknown }).env;
    if (!Array.isArray(env)) continue;
    for (const name of env) if (typeof name === 'string') names.add(name);
  }
  return names;
}

function hasDomainsDirectory(
  root: string,
  pathExists: (path: string) => boolean,
  isDirectory: (path: string) => boolean,
): boolean {
  const directory = join(root, 'src', 'domains');
  return pathExists(directory) && isDirectory(directory);
}

function missingDomainsError(root: string): DomainBoundaryError {
  return {
    path: posixPath(root, join(root, 'src', 'domains')) || DOMAINS_RELATIVE,
    reason: 'src/domains directory not found',
  };
}

function resolveRepositoryRoot(
  options: DomainBoundaryOptions,
  pathExists: (path: string) => boolean,
  isDirectory: (path: string) => boolean,
): { root: string } | { error: DomainBoundaryError } {
  if (options.root !== undefined) {
    const root = resolve(options.root);
    return hasDomainsDirectory(root, pathExists, isDirectory) ? { root } : { error: missingDomainsError(root) };
  }

  let current = resolve(process.cwd());
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    if (hasDomainsDirectory(current, pathExists, isDirectory)) return { root: current };
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }

  if (hasDomainsDirectory(SCRIPT_REPOSITORY_ROOT, pathExists, isDirectory)) return { root: SCRIPT_REPOSITORY_ROOT };
  return { error: missingDomainsError(SCRIPT_REPOSITORY_ROOT) };
}

function domainFiles(
  root: string,
  listDirectory: (path: string) => string[],
  pathExists: (path: string) => boolean,
  isDirectory: (path: string) => boolean,
): { files: string[] } | { error: DomainBoundaryError } {
  const directory = join(root, 'src', 'domains');
  if (!pathExists(directory) || !isDirectory(directory)) return { error: missingDomainsError(root) };
  try {
    const files: string[] = [];
    for (const entry of listDirectory(directory).sort()) {
      if (entry.endsWith('.test.ts') || !entry.endsWith('.ts')) continue;
      const path = join(directory, entry);
      if (isDirectory(path)) continue;
      files.push(path);
    }
    return {
      files: files.sort((left, right) => posixPath(root, left).localeCompare(posixPath(root, right))),
    };
  } catch (error) {
    return { error: observationError(posixPath(root, directory) || DOMAINS_RELATIVE, error) };
  }
}

function financialPrefix(relativePath: string): string | undefined {
  const parts = relativePath.split('/');
  const basename = parts.at(-1) ?? relativePath;
  const candidates = [basename];
  if (parts[0] === 'src' && parts[1] === 'domains' && parts[2]) candidates.push(parts[2]);
  for (const candidate of candidates) {
    const stem = stripJsTsExtension(candidate);
    for (const prefix of FINANCIAL_PREFIX_HYPOTHESIS) {
      if (stem === prefix || stem.startsWith(`${prefix}-`)) return prefix;
    }
  }
  return undefined;
}

function stripJsTsExtension(path: string): string {
  return path.replace(/\.(?:js|ts)$/, '');
}

function isCoreZonePath(relativePath: string): boolean {
  return CORE_ZONES.some((zone) => relativePath === zone || relativePath.startsWith(`${zone}/`));
}

function isTestImporter(relativePath: string): boolean {
  return relativePath.endsWith('.test.ts');
}

function staticRelativeSpecifiers(importerPath: string, contents: string): string[] {
  const kind = importerPath.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(importerPath, contents, ts.ScriptTarget.Latest, true, kind);
  const specifiers: string[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    if (ts.isImportDeclaration(statement) && !statement.importClause) continue;
    if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (specifier.startsWith('.')) specifiers.push(specifier);
  }
  return specifiers;
}

function resolveRelativeImportPath(importerPath: string, specifier: string): string {
  return posix.normalize(posix.join(posix.dirname(importerPath), specifier));
}

function domainTargetCandidates(resolved: string): string[] {
  const withoutExtension = stripJsTsExtension(resolved);
  const candidates = [
    resolved,
    `${withoutExtension}.ts`,
    `${withoutExtension}.js`,
    `${withoutExtension}/index.ts`,
    `${withoutExtension}/index.js`,
  ];
  return [...new Set(candidates)];
}

function isDomainRelativePath(relativePath: string): boolean {
  return relativePath === DOMAINS_RELATIVE || relativePath.startsWith(`${DOMAINS_RELATIVE}/`);
}

function resolveDomainTarget(
  importerPath: string,
  specifier: string,
  domainFilesByPath: ReadonlySet<string>,
): string | undefined {
  for (const candidate of domainTargetCandidates(resolveRelativeImportPath(importerPath, specifier))) {
    if (!isDomainRelativePath(candidate)) continue;
    if (domainFilesByPath.has(candidate)) return candidate;
  }
  return undefined;
}

function createFileReadCache(root: string, seams: FsSeams, errors: DomainBoundaryError[]): FileReadCache {
  const contentsByPath = new Map<string, string | undefined>();
  const failureByPath = new Map<string, string>();
  return {
    readRelative(relativePath: string): string | undefined {
      if (contentsByPath.has(relativePath)) return contentsByPath.get(relativePath);
      try {
        const contents = seams.readFile(join(root, ...relativePath.split('/')));
        contentsByPath.set(relativePath, contents);
        return contents;
      } catch (error) {
        const reason = failureReason(error);
        contentsByPath.set(relativePath, undefined);
        failureByPath.set(relativePath, reason);
        errors.push(observationError(relativePath, error));
        return undefined;
      }
    },
    failureReasonOf(relativePath: string): string | undefined {
      return failureByPath.get(relativePath);
    },
  };
}

function walkSourceFiles(
  directory: string,
  root: string,
  files: string[],
  seams: FsSeams,
  errors: DomainBoundaryError[],
  options: { includeTests?: boolean } = {},
): void {
  let entries: string[];
  try {
    entries = seams.listDirectory(directory);
  } catch (error) {
    errors.push(observationError(posixPath(root, directory) || directory, error));
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const path = join(directory, entry);
    let directoryEntry = false;
    try {
      directoryEntry = seams.isDirectory(path);
    } catch (error) {
      errors.push(observationError(posixPath(root, path) || path, error));
      continue;
    }
    if (directoryEntry) {
      walkSourceFiles(path, root, files, seams, errors, options);
      continue;
    }
    if (!entry.endsWith('.ts') && !entry.endsWith('.js')) continue;
    const relativePath = posixPath(root, path);
    if (!options.includeTests && isTestImporter(relativePath)) continue;
    files.push(relativePath);
  }
}

function collectDomainTargets(
  root: string,
  seams: FsSeams,
  errors: DomainBoundaryError[],
): Set<string> {
  const files: string[] = [];
  const directory = join(root, 'src', 'domains');
  if (!seams.pathExists(directory)) return new Set();
  let directoryEntry = false;
  try {
    directoryEntry = seams.isDirectory(directory);
  } catch (error) {
    errors.push(observationError(DOMAINS_RELATIVE, error));
    return new Set();
  }
  if (!directoryEntry) return new Set();
  walkSourceFiles(directory, root, files, seams, errors, { includeTests: false });
  return new Set(files.filter((path) => isDomainRelativePath(path)));
}

function collectImportEvidence(
  root: string,
  domainFilePaths: readonly string[],
  seams: FsSeams,
  errors: DomainBoundaryError[],
  reads: FileReadCache,
): Map<string, ImportEvidence> {
  const evidence = new Map<string, ImportEvidence>();
  const domainTargets = collectDomainTargets(root, seams, errors);
  const population = new Set(domainFilePaths);
  const remember = (path: string): ImportEvidence => {
    const current = evidence.get(path) ?? {};
    evidence.set(path, current);
    return current;
  };

  for (const domainPath of domainFilePaths) {
    const contents = reads.readRelative(domainPath);
    if (contents === undefined) continue;
    for (const specifier of staticRelativeSpecifiers(domainPath, contents)) {
      const target = resolveDomainTarget(domainPath, specifier, domainTargets);
      if (!target) continue;
      if (!financialPrefix(target)) continue;
      const current = remember(domainPath);
      if (!current.financialImport) current.financialImport = target;
    }
  }

  const importerFiles: string[] = [];
  for (const zone of CORE_ZONES) {
    const directory = join(root, ...zone.split('/'));
    if (!seams.pathExists(directory)) continue;
    let directoryEntry = false;
    try {
      directoryEntry = seams.isDirectory(directory);
    } catch (error) {
      errors.push(observationError(zone, error));
      continue;
    }
    if (!directoryEntry) continue;
    walkSourceFiles(directory, root, importerFiles, seams, errors);
  }

  for (const importerPath of importerFiles.sort((left, right) => left.localeCompare(right))) {
    if (isTestImporter(importerPath) || !isCoreZonePath(importerPath)) continue;
    const contents = reads.readRelative(importerPath);
    if (contents === undefined) continue;
    for (const specifier of staticRelativeSpecifiers(importerPath, contents)) {
      const target = resolveDomainTarget(importerPath, specifier, domainTargets);
      if (!target || !population.has(target)) continue;
      const current = remember(target);
      if (!current.coreImporter) current.coreImporter = importerPath;
    }
  }

  return evidence;
}

function credentialInContents(contents: string, names: Iterable<string>): string | undefined {
  return sorted(names).find((name) => contents.includes(name));
}

function staticRelativeFromSpecifiers(contents: string, fileName: string): string[] {
  const source = ts.createSourceFile(fileName, contents, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const moduleSpecifier = statement.moduleSpecifier.text;
    if (moduleSpecifier.startsWith('.')) specifiers.push(moduleSpecifier);
  }
  return specifiers;
}

function relativeImportCandidates(base: string): string[] {
  if (base.endsWith('.js')) return [`${base.slice(0, -3)}.ts`, base];
  if (base.endsWith('.ts')) return [base, `${base.slice(0, -3)}.js`];
  return [`${base}.ts`, `${base}.js`, `${base}/index.ts`, `${base}/index.js`];
}

function isRepositoryRelative(path: string): boolean {
  return path !== '..' && !path.startsWith('../') && !posix.isAbsolute(path);
}

function isDomainRelative(path: string): boolean {
  return path === DOMAINS_RELATIVE || path.startsWith(`${DOMAINS_RELATIVE}/`);
}

function resolveRelativeImport(
  importerRelativePath: string,
  specifier: string,
  root: string,
  pathExists: (path: string) => boolean,
): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = posix.normalize(posix.join(posix.dirname(importerRelativePath), specifier));
  if (!isRepositoryRelative(base)) return undefined;
  for (const candidate of relativeImportCandidates(base)) {
    if (!isRepositoryRelative(candidate)) continue;
    if (pathExists(join(root, candidate))) return candidate;
  }
  return undefined;
}

function credentialThroughImports(
  relativePath: string,
  contents: string,
  credentialNames: Set<string>,
  root: string,
  readFile: (path: string) => string,
  pathExists: (path: string) => boolean,
  errors: DomainBoundaryError[],
  cache: Map<string, string>,
  visiting: Set<string>,
): string | undefined {
  const own = credentialInContents(contents, credentialNames);
  if (own) {
    cache.set(relativePath, own);
    return own;
  }
  const cached = cache.get(relativePath);
  if (cached) return cached;
  if (visiting.has(relativePath)) return undefined;
  visiting.add(relativePath);
  let found: string | undefined;
  try {
    for (const specifier of staticRelativeFromSpecifiers(contents, relativePath)) {
      const resolved = resolveRelativeImport(relativePath, specifier, root, pathExists);
      if (!resolved || !isDomainRelative(resolved) || resolved.endsWith('.test.ts')) continue;
      let importedContents: string;
      try {
        importedContents = readFile(join(root, resolved));
      } catch (error) {
        errors.push(observationError(resolved, error));
        continue;
      }
      found = credentialThroughImports(
        resolved,
        importedContents,
        credentialNames,
        root,
        readFile,
        pathExists,
        errors,
        cache,
        visiting,
      );
      if (found) return found;
    }
    return undefined;
  } finally {
    visiting.delete(relativePath);
    if (found) cache.set(relativePath, found);
  }
}

function parseConfirmations(contents: string): {
  confirmations: DomainBoundaryConfirmations;
  errors: DomainBoundaryError[];
} {
  const parsed = JSON.parse(contents) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('confirmations must be a JSON object of path → { verdict, evidence }');
  }
  const confirmations: DomainBoundaryConfirmations = {};
  const errors: DomainBoundaryError[] = [];
  for (const [rawPath, value] of Object.entries(parsed as Record<string, unknown>)) {
    const path = rawPath.replace(/^\.\//, '').split(sep).join('/');
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      errors.push({ path, reason: 'confirmation must be an object with verdict core or company-only' });
      continue;
    }
    const verdict = (value as { verdict?: unknown }).verdict;
    if (verdict !== 'core' && verdict !== 'company-only') {
      errors.push({
        path,
        reason: `verdict must be 'core' or 'company-only' (got ${JSON.stringify(verdict)})`,
      });
      continue;
    }
    const evidenceValue = (value as { evidence?: unknown }).evidence;
    const evidence = typeof evidenceValue === 'string' && evidenceValue ? evidenceValue : HUMAN_CONFIRMED;
    confirmations[path] = { verdict, evidence };
  }
  return { confirmations, errors };
}

function loadConfirmations(
  options: DomainBoundaryOptions,
  root: string,
  readFile: (path: string) => string,
  pathExists: (path: string) => boolean,
): { confirmations: DomainBoundaryConfirmations; errors: DomainBoundaryError[] } {
  if (options.confirmations) return { confirmations: options.confirmations, errors: [] };
  const path = resolve(root, options.confirmationsPath ?? DEFAULT_CONFIRMATIONS_PATH);
  if (!pathExists(path)) return { confirmations: {}, errors: [] };
  try {
    return parseConfirmations(readFile(path));
  } catch (error) {
    return { confirmations: {}, errors: [observationError(path, error)] };
  }
}

function loadCredentialNames(
  resourceMapPath: string,
  readFile: (path: string) => string,
): { names: Set<string>; error?: DomainBoundaryError } {
  try {
    return { names: namesFromResourceMap(readFile(resourceMapPath)) };
  } catch (error) {
    return { names: new Set(), error: observationError(resourceMapPath, error) };
  }
}

function classifyFile(
  relativePath: string,
  contents: string,
  credentialNames: Set<string>,
  confirmations: DomainBoundaryConfirmations,
  importEvidence: ImportEvidence,
  importContext: {
    root: string;
    readFile: (path: string) => string;
    pathExists: (path: string) => boolean;
    errors: DomainBoundaryError[];
    cache: Map<string, string>;
  },
): DomainBoundaryRecord {
  const credential = credentialThroughImports(
    relativePath,
    contents,
    credentialNames,
    importContext.root,
    importContext.readFile,
    importContext.pathExists,
    importContext.errors,
    importContext.cache,
    new Set(),
  );
  if (credential) {
    return { path: relativePath, verdict: 'company-only', evidence: credential };
  }
  const confirmation = confirmations[relativePath];
  if (confirmation) {
    return { path: relativePath, verdict: confirmation.verdict, evidence: confirmation.evidence };
  }
  const prefix = financialPrefix(relativePath);
  if (prefix) {
    return { path: relativePath, verdict: 'company-only', evidence: prefix };
  }
  if (importEvidence.financialImport) {
    return { path: relativePath, verdict: 'company-only', evidence: importEvidence.financialImport };
  }
  if (importEvidence.coreImporter) {
    return { path: relativePath, verdict: 'core', evidence: importEvidence.coreImporter };
  }
  return { path: relativePath, verdict: 'unknown', evidence: NO_RULE_MATCHED };
}

function summarize(records: readonly DomainBoundaryRecord[]): DomainBoundarySummary {
  const summary: DomainBoundarySummary = { core: 0, 'company-only': 0, unknown: 0, total: records.length };
  for (const record of records) summary[record.verdict] += 1;
  return summary;
}

function emptyResult(errors: DomainBoundaryError[]): DomainBoundaryResult {
  return { records: [], summary: summarize([]), errors };
}

export function formatDomainBoundarySummary(summary: DomainBoundarySummary): string {
  return `core ${summary.core} · company-only ${summary['company-only']} · unknown ${summary.unknown} · 합 ${summary.total}`;
}

export function checkDomainBoundary(options: DomainBoundaryOptions = {}): DomainBoundaryResult {
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  const listDirectory = options.listDirectory ?? ((path: string) => readdirSync(path));
  const pathExists = options.pathExists ?? existsSync;
  const isDirectory = options.isDirectory ?? ((path: string) => statSync(path).isDirectory());
  const resolved = resolveRepositoryRoot(options, pathExists, isDirectory);
  if ('error' in resolved) return emptyResult([resolved.error]);

  const root = resolved.root;
  const errors: DomainBoundaryError[] = [];
  const resourceMapPath = resolve(root, options.resourceMapPath ?? 'catalog/resources.yaml');
  const credentialNames = loadCredentialNames(resourceMapPath, readFile);
  if (credentialNames.error) errors.push(credentialNames.error);
  const confirmations = loadConfirmations(options, root, readFile, pathExists);
  errors.push(...confirmations.errors);

  const listed = domainFiles(root, listDirectory, pathExists, isDirectory);
  if ('error' in listed) return { records: [], summary: summarize([]), errors: [...errors, listed.error] };

  const seams: FsSeams = { readFile, listDirectory, pathExists, isDirectory };
  const domainRelativePaths = listed.files.map((path) => posixPath(root, path));
  const reads = createFileReadCache(root, seams, errors);
  const importEvidence = collectImportEvidence(root, domainRelativePaths, seams, errors, reads);
  const importCache = new Map<string, string>();

  const records = listed.files.map((path) => {
    const relativePath = posixPath(root, path);
    const contents = reads.readRelative(relativePath);
    if (contents === undefined) {
      return {
        path: relativePath,
        verdict: 'unknown' as const,
        evidence: formatUnreadableEvidence(reads.failureReasonOf(relativePath) ?? 'unknown read failure'),
      };
    }
    try {
      return classifyFile(
        relativePath,
        contents,
        credentialNames.names,
        confirmations.confirmations,
        importEvidence.get(relativePath) ?? {},
        {
          root,
          readFile,
          pathExists,
          errors,
          cache: importCache,
        },
      );
    } catch (error) {
      errors.push(observationError(relativePath, error));
      return { path: relativePath, verdict: 'unknown' as const, evidence: formatUnreadableEvidence(failureReason(error)) };
    }
  });
  return { records, summary: summarize(records), errors };
}

export function main(options: DomainBoundaryCliOptions = {}): DomainBoundaryResult {
  const result = checkDomainBoundary(options);
  const out = options.out ?? console;
  const argv = options.argv ?? process.argv.slice(2);
  if (argv.includes('--json')) {
    out.log(JSON.stringify({ records: result.records, summary: result.summary, errors: result.errors }, null, 2));
  } else {
    for (const error of result.errors) out.log(`error: ${error.path} (${error.reason})`);
    for (const record of result.records) out.log(`${record.path}  ${record.verdict}  ${record.evidence}`);
    out.log(formatDomainBoundarySummary(result.summary));
  }
  (options.setExitCode ?? ((code: number) => { process.exitCode = code; }))(result.errors.length > 0 ? 1 : 0);
  return result;
}

if (import.meta.main) main();
