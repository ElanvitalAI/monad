import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { parse as parseYaml } from 'yaml';

export type ResourceMapCredential = { id: string; envNames: string[] };
export type ResourceMapExcluded = { envName: string; reason: string };
export type ResourceMapUnreadable = { path: string; reason: string };
export type ResourceMapCheckResult = {
  credentials: ResourceMapCredential[];
  covered: ResourceMapCredential[];
  uncovered: ResourceMapCredential[];
  excluded: ResourceMapExcluded[];
  unreadable: ResourceMapUnreadable[];
  unknown: string[];
  emptyFreeFallbackIds: string[];
};
export type CheckResourceMapOptions = {
  root?: string;
  sourceRoots?: string[];
  resourceMapPath?: string;
  readFile?: (path: string) => string;
  listDirectory?: (path: string) => string[];
  pathExists?: (path: string) => boolean;
  isDirectory?: (path: string) => boolean;
};
export type ResourceMapCliOptions = CheckResourceMapOptions & {
  write?: (text: string) => void;
  setExitCode?: (code: number) => void;
};
/** ⭐ `mcp` 는 2026-09-22 에 열었다 — ***자격을 MCP 서버가 쥐는 부류***다.
 *  🩸 계기: topview · higgsfield · epidemic 셋이 맵에 «없었고», 이유가 오탈자가 아니라 정의역이었다.
 *    실측: 저장소 env 변수 420개 중 TOPVIEW*·HIGGSFIELD*·EPIDEMIC* 는 ***0개***.
 *    이 맵은 「env 를 읽는 자리」를 색인하므로 ***읽을 env 가 없는 서비스는 원리상 안 보였다.***
 *  ⇒ `mcp` 도 「자격이 필요한」 부류라 free_fallback 을 똑같이 요구받는다. */
export type ResourceMapCatalogAuth = 'api-key' | 'oauth-browser' | 'cli-login' | 'mcp' | 'none';

/** free 경로가 «어떻게» 닿나. ⭐ 🅣 제안(2026-09-22) — 불린이 아니라 «셋»이라야 거짓말을 안 한다.
 *   auto    자격이 없으면 도구가 «스스로» 무료 경로로 간다        ⇒ 코어
 *   manual  무료 경로가 in-tree 로 있으나 «사람이 말해야» 간다     ⇒ 애드온 (기본값이 돈을 쓴다)
 *   none    무료 경로가 없다                                     ⇒ 애드온
 *  📏 실사례: elevenlabs 는 edge-tts·macos-say 가 implemented 인데
 *    resolveProviderId() 기본값이 'openai-tts'(유료)라 ***manual*** 이다. */
export type FreeFallbackMode = 'auto' | 'manual' | 'none';
export type ResourceMapCatalogEntry = {
  id?: unknown;
  auth?: unknown;
  free_fallback?: unknown;
};

const CREDENTIAL_REQUIRING_AUTH = new Set<ResourceMapCatalogAuth>(['api-key', 'oauth-browser', 'cli-login', 'mcp']);
const FREE_FALLBACK_MODES = new Set<string>(['auto', 'manual', 'none']);

function requiresCredential(auth: unknown): boolean {
  return typeof auth === 'string' && CREDENTIAL_REQUIRING_AUTH.has(auth as ResourceMapCatalogAuth);
}

/** ⛔ 「빈칸」은 «무료 경로가 없다»가 아니라 ***「아직 안 답했다」***다. 둘을 접으면 애드온 판정이 공짜로 생긴다.
 *  ⇒ 산문(`free_fallback`)이 있거나 «모드»(`free_fallback_mode`)가 셋 중 하나면 ***답한 것***이다.
 *    특히 `none` 은 빈칸이 «아니다» — 「무료 경로가 없음을 확인했다」는 답이다. */
function isEmptyFreeFallback(value: unknown, mode?: unknown): boolean {
  if (typeof mode === 'string' && FREE_FALLBACK_MODES.has(mode.trim())) return false;
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

export function credentialIdsWithEmptyFreeFallback(entries: readonly ResourceMapCatalogEntry[]): string[] {
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.id !== 'string' || entry.id.trim() === '') continue;
    if (!requiresCredential(entry.auth)) continue;
    if (!isEmptyFreeFallback(entry.free_fallback, (entry as { free_fallback_mode?: unknown }).free_fallback_mode)) continue;
    ids.push(entry.id);
  }
  return ids;
}

const credentialTail = /(?:^|_)(?:API_)?(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)$/;
const excludedTailReasons: Array<[RegExp, string]> = [
  [/(?:^|_)(?:URL|URI|BASE_URL|ENDPOINT)$/, 'URL or endpoint configuration is not a credential.'],
  [/(?:^|_)(?:DIR|PATH|FILE|CACHE_DIR)$/, 'Filesystem location configuration is not a credential.'],
  [/(?:^|_)(?:MODEL|PROVIDER|REGION|PROJECT|TIMEOUT|LIMIT|TTL)$/, 'Runtime configuration is not a credential.'],
];

function staticAccessName(node: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  const argument = node.argumentExpression;
  return argument && ts.isStringLiteral(argument) ? argument.text : undefined;
}

function isRuntimeEnvironment(node: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return false;
  return staticAccessName(node) === 'env' && ts.isIdentifier(node.expression) && (node.expression.text === 'process' || node.expression.text === 'Bun');
}

type EnvironmentBinding = 'environment' | 'non-environment' | 'unknown';

type BindingDeclaration = { name: ts.Identifier; initializer?: ts.Expression; scope: ts.Node; reassignable: boolean };

function bindingScope(node: ts.ParameterDeclaration | ts.VariableDeclaration): ts.Node {
  if (ts.isParameter(node)) return node.parent;
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isForInStatement(current) || ts.isForOfStatement(current) || ts.isForStatement(current) || ts.isCatchClause(current)) return current;
    if (ts.isBlock(current) || ts.isSourceFile(current) || ts.isFunctionLike(current)) return current;
  }
  return node.getSourceFile();
}

function contains(scope: ts.Node, node: ts.Node): boolean {
  return scope.pos <= node.pos && node.end <= scope.end;
}

function unparenthesized(node: ts.Expression): ts.Expression {
  let expression = node;
  while (ts.isParenthesizedExpression(expression)) expression = expression.expression;
  return expression;
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.EqualsToken || (kind >= ts.SyntaxKind.FirstCompoundAssignment && kind <= ts.SyntaxKind.LastCompoundAssignment);
}

class EnvironmentBindings {
  private readonly declarations: BindingDeclaration[] = [];

  constructor(source: ts.SourceFile) {
    const visit = (node: ts.Node): void => {
      if ((ts.isParameter(node) || ts.isVariableDeclaration(node)) && ts.isIdentifier(node.name)) {
        this.declarations.push({
          name: node.name,
          initializer: node.initializer,
          scope: bindingScope(node),
          reassignable: ts.isParameter(node) || (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Let) !== 0),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  private declaration(identifier: ts.Identifier): BindingDeclaration | undefined {
    return this.declarations
      .filter((candidate) => candidate.name.text === identifier.text && candidate.name.pos < identifier.pos && contains(candidate.scope, identifier))
      .sort((left, right) => right.scope.pos - left.scope.pos || right.name.pos - left.name.pos)[0];
  }

  private reassigned(declaration: BindingDeclaration): boolean {
    let assigned = false;
    const visit = (node: ts.Node): void => {
      if (node === declaration.name) return;
      if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind) && ts.isIdentifier(node.left) && node.left.text === declaration.name.text && this.declaration(node.left) === declaration) assigned = true;
      ts.forEachChild(node, visit);
    };
    visit(declaration.scope);
    return assigned;
  }

  private classifyInitializer(initializer: ts.Expression, seen: Set<BindingDeclaration>): EnvironmentBinding {
    const expression = unparenthesized(initializer);
    if (isRuntimeEnvironment(expression)) return 'environment';
    if (ts.isIdentifier(expression)) return this.classify(expression, seen);
    if (ts.isBinaryExpression(expression) && (expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || expression.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      const left = this.classifyInitializer(expression.left, seen);
      if (left === 'non-environment') return 'non-environment';
      const right = this.classifyInitializer(expression.right, seen);
      return right === 'environment' ? 'environment' : 'unknown';
    }
    if (ts.isObjectLiteralExpression(expression) || ts.isArrayLiteralExpression(expression) || ts.isNewExpression(expression) || ts.isCallExpression(expression)) return 'non-environment';
    return 'unknown';
  }

  classify(identifier: ts.Identifier, seen = new Set<BindingDeclaration>()): EnvironmentBinding {
    const declaration = this.declaration(identifier);
    if (!declaration || seen.has(declaration) || (declaration.reassignable && this.reassigned(declaration)) || !declaration.initializer) return 'unknown';
    return this.classifyInitializer(declaration.initializer, new Set([...seen, declaration]));
  }
}

function environmentRead(node: ts.Node, bindings: EnvironmentBindings): { name?: string; unknown?: string } | undefined {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return undefined;
  const name = staticAccessName(node);
  const target = node.expression;
  if (!name) return undefined;
  if (isRuntimeEnvironment(target)) return { name };
  if (!ts.isIdentifier(target)) return undefined;
  return bindings.classify(target) === 'environment' ? { name } : bindings.classify(target) === 'unknown' ? { unknown: name } : undefined;
}

function fallbackEnvironmentReads(node: ts.Expression, bindings: EnvironmentBindings): string[] | undefined {
  let expression = node;
  while (ts.isParenthesizedExpression(expression)) expression = expression.expression;
  const read = environmentRead(expression, bindings);
  if (read?.name) return [read.name];
  if (!ts.isBinaryExpression(expression)) return undefined;
  if (expression.operatorToken.kind !== ts.SyntaxKind.BarBarToken && expression.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken) return undefined;
  const left = fallbackEnvironmentReads(expression.left, bindings);
  const right = fallbackEnvironmentReads(expression.right, bindings);
  return left && right ? [...new Set([...left, ...right])] : undefined;
}

function exclusionReason(envName: string): string | undefined {
  for (const [pattern, reason] of excludedTailReasons) if (pattern.test(envName)) return reason;
  return credentialTail.test(envName) ? undefined : 'Name does not end in a credential-bearing suffix.';
}

function sourceFiles(root: string, sourceRoots: readonly string[], listDirectory: (path: string) => string[], pathExists: (path: string) => boolean, isDirectory: (path: string) => boolean): string[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    if (!pathExists(directory)) return;
    for (const entry of listDirectory(directory).sort()) {
      const path = join(directory, entry);
      if (entry === 'node_modules' || entry.startsWith('.') || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry)) continue;
      if (isDirectory(path)) walk(path);
      else if (/\.[cm]?[jt]sx?$/.test(entry)) files.push(path);
    }
  };
  for (const sourceRoot of sourceRoots) walk(resolve(root, sourceRoot));
  return files.sort();
}

function unreadable(path: string, error: unknown): ResourceMapUnreadable {
  return { path, reason: error instanceof Error && error.message ? error.message : String(error) || 'unknown read failure' };
}

function resourceMapEnvironmentNames(path: string, readFile: (path: string) => string): { names: Set<string>; unreadable: ResourceMapUnreadable[]; entries: ResourceMapCatalogEntry[] } {
  try {
    const document = parseYaml(readFile(path)) as { resources?: unknown } | null;
    const names = new Set<string>();
    const entries: ResourceMapCatalogEntry[] = [];
    if (Array.isArray(document?.resources)) {
      for (const resource of document.resources) {
        entries.push(resource as ResourceMapCatalogEntry);
        if (!resource || typeof resource !== 'object') continue;
        const env = (resource as { env?: unknown }).env;
        if (!Array.isArray(env)) continue;
        for (const name of env) if (typeof name === 'string') names.add(name);
      }
    }
    return { names, unreadable: [], entries };
  } catch (error) {
    return { names: new Set(), unreadable: [unreadable(path, error)], entries: [] };
  }
}

export function checkResourceMap(options: CheckResourceMapOptions = {}): ResourceMapCheckResult {
  const root = resolve(options.root ?? process.cwd());
  const read = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  const list = options.listDirectory ?? ((path: string) => readdirSync(path));
  const exists = options.pathExists ?? existsSync;
  const isDirectory = options.isDirectory ?? ((path: string) => statSync(path).isDirectory());
  const parent = new Map<string, string>();
  const order: string[] = [];
  const unknown = new Set<string>();
  const add = (name: string): void => { if (!parent.has(name)) { parent.set(name, name); order.push(name); } };
  const find = (name: string): string => { const current = parent.get(name)!; if (current === name) return name; const rootName = find(current); parent.set(name, rootName); return rootName; };
  const union = (left: string, right: string): void => { const leftRoot = find(left); const rightRoot = find(right); if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot); };

  for (const file of sourceFiles(root, options.sourceRoots ?? ['src', 'scripts'], list, exists, isDirectory)) {
    const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
    const bindings = new EnvironmentBindings(ast);
    const visit = (node: ts.Node): void => {
      const environment = environmentRead(node, bindings);
      if (environment?.name) add(environment.name);
      if (environment?.unknown && credentialTail.test(environment.unknown)) unknown.add(environment.unknown);
      if (ts.isBinaryExpression(node)) {
        const aliases = fallbackEnvironmentReads(node, bindings);
        if (aliases) { for (const alias of aliases) add(alias); for (const alias of aliases.slice(1)) union(aliases[0]!, alias); }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  const excluded: ResourceMapExcluded[] = [];
  const credentialNames = new Set<string>();
  for (const envName of order) { const reason = exclusionReason(envName); if (reason) excluded.push({ envName, reason }); else credentialNames.add(envName); }
  const groups = new Map<string, string[]>();
  for (const envName of order) if (credentialNames.has(envName)) { const key = find(envName); groups.set(key, [...(groups.get(key) ?? []), envName]); }
  const credentials = [...groups.values()].map((envNames) => ({ id: envNames[0]!, envNames })).sort((a, b) => a.id.localeCompare(b.id));
  const resourceMapPath = resolve(root, options.resourceMapPath ?? 'catalog/resources.yaml');
  const resourceMap = resourceMapEnvironmentNames(resourceMapPath, read);
  const covered = credentials.filter((credential) => credential.envNames.some((envName) => resourceMap.names.has(envName)));
  const coveredIds = new Set(covered.map(({ id }) => id));
  const emptyFreeFallbackIds = credentialIdsWithEmptyFreeFallback(resourceMap.entries);
  return {
    credentials,
    covered,
    uncovered: resourceMap.unreadable.length ? [] : credentials.filter((credential) => !coveredIds.has(credential.id)),
    excluded: excluded.sort((a, b) => a.envName.localeCompare(b.envName)),
    unreadable: resourceMap.unreadable,
    unknown: [...unknown].sort(),
    emptyFreeFallbackIds,
  };
}

export function runResourceMapCheckCli(options: ResourceMapCliOptions = {}): ResourceMapCheckResult {
  const result = checkResourceMap(options);
  (options.write ?? ((text: string) => console.log(text)))(JSON.stringify(result, null, 2));
  (options.setExitCode ?? ((code: number) => { process.exitCode = code; }))(result.uncovered.length > 0 || result.unreadable.length > 0 ? 1 : 0);
  return result;
}

if (import.meta.main) runResourceMapCheckCli();
