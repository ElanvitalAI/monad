#!/usr/bin/env bun
/** F12 ruler: exported value symbols with no observed static or registry-mediated reachability. */
import { existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type ExportKind = 'interface' | 'type' | 'function' | 'const' | 'class' | 'enum';
export type ExportGroup = 'type-only' | 'value';

type Ts = typeof import('typescript');
type Symbol = import('typescript').Symbol;

export interface ExportedSymbol {
  file: string;
  name: string;
  kind: ExportKind;
  group: ExportGroup;
  symbol: Symbol;
}

export interface StringConstant {
  file: string;
  name: string;
  value: string;
}

/** One site where a string literal repeats the value of a string constant exported elsewhere. */
export interface BypassedConstantSite {
  file: string;
  line: number;
  value: string;
  constName: string;
  constFile: string;
  /** The bypassing file already imports the declaring module, so nothing prevented importing the constant. */
  declaringModuleImported: boolean;
  inTest: boolean;
}

export interface BucketBReport {
  scanRoots: string[];
  /** Scopes that exist in the ruler but could not be measured on this root; never folded into zero. */
  unavailableScopes: string[];
  filesScanned: number;
  literalsScanned: number;
  constantsScanned: number;
  sites: BypassedConstantSite[];
}

export interface F12Report {
  filesScanned: number;
  exportsScanned: number;
  referencedElsewhere: number;
  referencedOnlyFromTests: number;
  unreferencedTypeOnly: ExportedSymbol[];
  bucketA: ExportedSymbol[];
  bucketB: BucketBReport;
  bucketD: ExportedSymbol[];
  elapsedSeconds: number;
}

class F12SweepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'F12SweepError';
  }
}

function loadTypeScript(root: string): Promise<Ts> {
  const candidates = [resolve(root, 'node_modules/typescript/lib/typescript.js'), resolve(import.meta.dir, '../node_modules/typescript/lib/typescript.js')];
  const compiler = candidates.find(existsSync);
  if (!compiler) throw new F12SweepError(`TypeScript compiler dependency was not found; searched ${candidates.join(', ')}; cannot measure root ${root}`);
  return import(pathToFileURL(compiler).href) as Promise<Ts>;
}

function resolveSymbol(ts: Ts, checker: import('typescript').TypeChecker, node: import('typescript').Node): Symbol | undefined {
  const symbol = checker.getSymbolAtLocation(node);
  return symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

function isTestFile(file: string): boolean {
  return /(?:^|[/\\])(test|tests|__tests__|__fixtures__)(?:[/\\]|$)|\.(?:test|spec)\.tsx?$/.test(file);
}

function exportKind(ts: Ts, symbol: Symbol): ExportKind {
  const flags = symbol.flags;
  if (flags & ts.SymbolFlags.Interface) return 'interface';
  if (flags & ts.SymbolFlags.TypeAlias) return 'type';
  if (flags & ts.SymbolFlags.Function) return 'function';
  if (flags & ts.SymbolFlags.Class) return 'class';
  if (flags & ts.SymbolFlags.Enum) return 'enum';
  return 'const';
}

function isTypeOnly(ts: Ts, symbol: Symbol): boolean {
  return Boolean(symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias))
    && !Boolean(symbol.flags & ts.SymbolFlags.Value);
}

function sourceExports(ts: Ts, checker: import('typescript').TypeChecker, source: import('typescript').SourceFile): ExportedSymbol[] {
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) return [];
  return checker.getExportsOfModule(moduleSymbol)
    .filter((symbol) => symbol.name !== 'default')
    .map((exported) => {
      const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      const kind = exportKind(ts, symbol);
      return { file: source.fileName, name: exported.name, kind, group: isTypeOnly(ts, symbol) ? 'type-only' : 'value', symbol };
    });
}

function declarationSource(symbol: Symbol): string | undefined {
  return symbol.declarations?.[0]?.getSourceFile().fileName;
}

function isRegistryRegister(ts: Ts, checker: import('typescript').TypeChecker, expression: import('typescript').Expression): boolean {
  if (!ts.isIdentifier(expression) || expression.text !== 'registerToolRuntime') return false;
  const raw = checker.getSymbolAtLocation(expression);
  if (!raw) return false;
  const candidates = raw.flags & ts.SymbolFlags.Alias ? [raw, checker.getAliasedSymbol(raw)] : [raw];
  if (candidates.some((symbol) => symbol.name === 'registerToolRuntime' && /(?:^|[/\\])tool-runtime[/\\]registry\.ts$/.test(declarationSource(symbol) ?? ''))) return true;
  return raw.declarations?.some((declaration) => {
    let current: import('typescript').Node | undefined = declaration;
    while (current && !ts.isImportDeclaration(current)) current = current.parent;
    return Boolean(current && ts.isStringLiteral(current.moduleSpecifier) && /(?:^|\/)tool-runtime\/registry(?:\.js)?$/.test(current.moduleSpecifier.text));
  }) ?? false;
}

function isRegistryLookup(ts: Ts, checker: import('typescript').TypeChecker, expression: import('typescript').Expression): boolean {
  if (!ts.isIdentifier(expression) || expression.text !== 'getToolRuntime') return false;
  const symbol = resolveSymbol(ts, checker, expression);
  return symbol?.name === 'getToolRuntime' && /(?:^|[/\\])tool-runtime[/\\]registry\.ts$/.test(declarationSource(symbol) ?? '');
}

function runtimeId(ts: Ts, checker: import('typescript').TypeChecker, expression: import('typescript').Expression): string | undefined {
  if (ts.isStringLiteral(expression)) return expression.text;
  if (!ts.isIdentifier(expression)) return undefined;
  const symbol = resolveSymbol(ts, checker, expression);
  const declaration = symbol?.declarations?.find(ts.isVariableDeclaration);
  return declaration?.initializer ? runtimeId(ts, checker, declaration.initializer) : undefined;
}

function catalogRuntimeIds(ts: Ts, program: import('typescript').Program, root: string): Map<string, string> {
  const aliases = new Map<string, string>();
  const catalog = program.getSourceFile(resolve(root, 'src/native-tool-catalog.ts'));
  if (!catalog) return aliases;
  const visit = (node: import('typescript').Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const properties = new Map(node.properties.filter(ts.isPropertyAssignment).flatMap((property) => {
        const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : undefined;
        return name ? [[name, property.initializer] as const] : [];
      }));
      const id = properties.get('id');
      const aliasList = properties.get('aliases');
      if (id && ts.isStringLiteral(id)) {
        aliases.set(id.text, id.text);
        if (aliasList && ts.isArrayLiteralExpression(aliasList)) {
          for (const alias of aliasList.elements) if (ts.isStringLiteral(alias)) aliases.set(alias.text, id.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(catalog);
  return aliases;
}

function hasRegistryAliasResolution(ts: Ts, program: import('typescript').Program, root: string): boolean {
  const registry = program.getSourceFile(resolve(root, 'src/tool-runtime/registry.ts'));
  if (!registry) return false;
  let resolved = false;
  const visit = (node: import('typescript').Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'getToolRuntime') {
      const parameter = node.parameters[0]?.name;
      if (!parameter || !ts.isIdentifier(parameter)) return;
      const entries = new Set<string>();
      const inspect = (child: import('typescript').Node): void => {
        if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name) && child.initializer && ts.isCallExpression(child.initializer) && ts.isIdentifier(child.initializer.expression) && child.initializer.expression.text === 'findNativeTool' && child.initializer.arguments.length === 1 && ts.isIdentifier(child.initializer.arguments[0]) && child.initializer.arguments[0].text === parameter.text) {
          entries.add(child.name.text);
        }
        if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression) && child.expression.name.text === 'get' && child.arguments[0] && ts.isPropertyAccessExpression(child.arguments[0]) && child.arguments[0].name.text === 'id' && ts.isIdentifier(child.arguments[0].expression) && entries.has(child.arguments[0].expression.text)) {
          resolved = true;
        }
        ts.forEachChild(child, inspect);
      };
      inspect(node.body ?? node);
    }
    ts.forEachChild(node, visit);
  };
  visit(registry);
  return resolved;
}

function registeredRuntimeSymbols(ts: Ts, program: import('typescript').Program, root: string): Set<Symbol> {
  const checker = program.getTypeChecker();
  const registered = new Set<Symbol>();
  const registeredIds = new Map<string, Symbol>();
  const dynamicallyReachedIds = new Set<string>();
  let hasDynamicRegistryLookup = false;
  const aliases = catalogRuntimeIds(ts, program, root);
  const canResolveAliases = hasRegistryAliasResolution(ts, program, root);
  const seen = new Set<Symbol>();
  const productionRoot = resolve(root, 'src') + '/';

  const collect = (expression: import('typescript').Expression): void => {
    if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) return collect(expression.expression);
    if (ts.isArrayLiteralExpression(expression)) {
      for (const element of expression.elements) {
        if (ts.isSpreadElement(element)) collect(element.expression);
        else collect(element);
      }
      return;
    }
    if (!ts.isIdentifier(expression)) return;
    const symbol = resolveSymbol(ts, checker, expression);
    if (!symbol || seen.has(symbol)) return;
    seen.add(symbol);
    const declarations = symbol.declarations ?? [];
    const variable = declarations.find(ts.isVariableDeclaration);
    if (variable?.initializer && (ts.isArrayLiteralExpression(variable.initializer) || ts.isIdentifier(variable.initializer) || ts.isParenthesizedExpression(variable.initializer) || ts.isAsExpression(variable.initializer) || ts.isTypeAssertionExpression(variable.initializer))) {
      collect(variable.initializer);
      return;
    }
    registered.add(symbol);
    const runtimeVariable = symbol.declarations?.find(ts.isVariableDeclaration);
    const idProperty = runtimeVariable?.initializer && ts.isObjectLiteralExpression(runtimeVariable.initializer)
      ? runtimeVariable.initializer.properties.find((property): property is import('typescript').PropertyAssignment => ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === 'id')
      : undefined;
    if (idProperty) {
      const id = runtimeId(ts, checker, idProperty.initializer);
      if (id) registeredIds.set(id, symbol);
    }
  };

  for (const source of program.getSourceFiles()) {
    if (source.isDeclarationFile || !source.fileName.startsWith(productionRoot)) continue;
    const visit = (node: import('typescript').Node): void => {
      if (ts.isCallExpression(node) && isRegistryRegister(ts, checker, node.expression) && node.arguments[0]) collect(node.arguments[0]);
      if (ts.isCallExpression(node) && isRegistryLookup(ts, checker, node.expression) && node.arguments[0] && canResolveAliases) {
        const id = runtimeId(ts, checker, node.arguments[0]);
        const canonicalId = id && aliases.get(id);
        if (canonicalId) dynamicallyReachedIds.add(canonicalId);
        else hasDynamicRegistryLookup = true;
      }
      if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer) && ts.isIdentifier(node.initializer.declarations[0]?.name)) {
        const iterationName = node.initializer.declarations[0]!.name.text;
        let registeredIteration = false;
        const inspectBody = (body: import('typescript').Node): void => {
          if (ts.isCallExpression(body) && isRegistryRegister(ts, checker, body.expression) && ts.isIdentifier(body.arguments[0]) && body.arguments[0].text === iterationName) registeredIteration = true;
          ts.forEachChild(body, inspectBody);
        };
        inspectBody(node.statement);
        if (registeredIteration) collect(node.expression);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  if (hasDynamicRegistryLookup) return registered;
  for (const id of dynamicallyReachedIds) {
    const symbol = registeredIds.get(id);
    if (symbol) registered.add(symbol);
  }
  return new Set([...registered].filter((symbol) => [...registeredIds.values()].includes(symbol) && [...dynamicallyReachedIds].some((id) => registeredIds.get(id) === symbol)));
}

function stringLiteralValue(ts: Ts, node: import('typescript').Node): string | undefined {
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isTypeAssertionExpression(node)) return stringLiteralValue(ts, node.expression);
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;
}

function isModuleSpecifier(ts: Ts, node: import('typescript').Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return parent.moduleSpecifier === node;
  if (ts.isImportTypeNode(parent) || ts.isModuleDeclaration(parent) || ts.isExternalModuleReference(parent)) return true;
  return ts.isCallExpression(parent)
    && parent.arguments[0] === node
    && (parent.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(parent.expression) && parent.expression.text === 'require'));
}

function isScanned(source: import('typescript').SourceFile, root: string): boolean {
  return !source.isDeclarationFile && source.fileName.startsWith(root) && !source.fileName.includes('/node_modules/');
}

function exportedStringConstants(ts: Ts, program: import('typescript').Program, root: string): StringConstant[] {
  const checker = program.getTypeChecker();
  const constants: StringConstant[] = [];
  for (const source of program.getSourceFiles()) {
    if (!isScanned(source, root) || isTestFile(source.fileName)) continue;
    const moduleSymbol = checker.getSymbolAtLocation(source);
    if (!moduleSymbol) continue;
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      if (exported.name === 'default') continue;
      const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      if (declarationSource(symbol) !== source.fileName) continue;
      const declaration = symbol.declarations?.find(ts.isVariableDeclaration);
      const value = declaration?.initializer && stringLiteralValue(ts, declaration.initializer);
      if (value) constants.push({ file: source.fileName, name: exported.name, value });
    }
  }
  return constants;
}

function importedModuleFiles(ts: Ts, checker: import('typescript').TypeChecker, source: import('typescript').SourceFile): Set<string> {
  const files = new Set<string>();
  for (const statement of source.statements) {
    const specifier = (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) ? statement.moduleSpecifier : undefined;
    if (!specifier || !ts.isStringLiteral(specifier)) continue;
    for (const declaration of checker.getSymbolAtLocation(specifier)?.declarations ?? []) files.add(declaration.getSourceFile().fileName);
  }
  return files;
}

/** Directories the ruler is expected to cover; each is reported as scanned or, by name, as unmeasured. */
const BUCKET_B_EXPECTED_SCOPES = ['src', 'scripts', 'test', 'apps/pwa/src'] as const;

/** Bucket b, statically decidable part: a constant exists and this site copied its value instead of importing it. */
function sweepBypassedConstants(ts: Ts, root: string, programs: readonly (import('typescript').Program)[]): BucketBReport {
  const constants = new Map<string, StringConstant>();
  for (const program of programs) {
    for (const constant of exportedStringConstants(ts, program, root)) {
      const held = constants.get(constant.value);
      if (!held || `${constant.file}#${constant.name}` < `${held.file}#${held.name}`) constants.set(constant.value, constant);
    }
  }
  const files = new Set<string>();
  const sites = new Map<string, BypassedConstantSite>();
  let literalsScanned = 0;
  for (const program of programs) {
    const checker = program.getTypeChecker();
    for (const source of program.getSourceFiles()) {
      if (!isScanned(source, root) || files.has(source.fileName)) continue;
      files.add(source.fileName);
      const imported = importedModuleFiles(ts, checker, source);
      const visit = (node: import('typescript').Node): void => {
        if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !isModuleSpecifier(ts, node)) {
          literalsScanned++;
          const constant = constants.get(node.text);
          if (constant && constant.file !== source.fileName) {
            const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
            sites.set(`${source.fileName}:${line}:${node.text}`, {
              file: relative(root, source.fileName),
              line,
              value: node.text,
              constName: constant.name,
              constFile: relative(root, constant.file),
              declaringModuleImported: imported.has(constant.file),
              inTest: isTestFile(relative(root, source.fileName)),
            });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  const covered = (scope: string) => [...files].some((file) => file.startsWith(resolve(root, scope) + '/'));
  return {
    scanRoots: BUCKET_B_EXPECTED_SCOPES.filter(covered),
    unavailableScopes: BUCKET_B_EXPECTED_SCOPES.filter((scope) => existsSync(resolve(root, scope)) && !covered(scope)),
    filesScanned: files.size,
    literalsScanned,
    constantsScanned: constants.size,
    sites: [...sites.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
  };
}

function programAt(ts: Ts, configPath: string): import('typescript').Program {
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath), { noEmit: true }, configPath);
  return ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, projectReferences: parsed.projectReferences });
}

export async function sweepF12(root = process.cwd()): Promise<F12Report> {
  const startedAt = performance.now();
  const ts = await loadTypeScript(resolve(root));
  root = resolve(root);
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) throw new Error(`tsconfig.json was not found under ${root}`);
  const program = programAt(ts, configPath);
  const checker = program.getTypeChecker();
  const srcRoot = resolve(root, 'src') + '/';
  const sources = program.getSourceFiles().filter((source) => !source.isDeclarationFile && source.fileName.startsWith(srcRoot));
  const exports = sources.flatMap((source) => sourceExports(ts, checker, source));
  const exportSymbols = new Map<Symbol, ExportedSymbol[]>();
  for (const item of exports) exportSymbols.set(item.symbol, [...(exportSymbols.get(item.symbol) ?? []), item]);
  const references = new Map<Symbol, Set<string>>();
  for (const source of program.getSourceFiles()) {
    if (source.isDeclarationFile) continue;
    const visit = (node: import('typescript').Node): void => {
      if (ts.isIdentifier(node)) {
        const symbol = resolveSymbol(ts, checker, node);
        if (symbol && exportSymbols.has(symbol)) references.set(symbol, new Set([...(references.get(symbol) ?? []), source.fileName]));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  const dynamic = registeredRuntimeSymbols(ts, program, root);
  const pwaConfig = resolve(root, 'apps/pwa/tsconfig.json');
  const pwaProgram = existsSync(pwaConfig) ? programAt(ts, pwaConfig) : undefined;
  const bucketB = sweepBypassedConstants(ts, root, pwaProgram ? [program, pwaProgram] : [program]);
  const unreferencedTypeOnly: ExportedSymbol[] = [];
  const bucketA: ExportedSymbol[] = [];
  const bucketD: ExportedSymbol[] = [];
  let referencedElsewhere = 0;
  let referencedOnlyFromTests = 0;
  for (const item of exports) {
    if (dynamic.has(item.symbol)) {
      bucketD.push(item);
      continue;
    }
    const external = [...(references.get(item.symbol) ?? [])].filter((file) => file !== item.file);
    const productionReferences = external.filter((file) => !isTestFile(relative(root, file)));
    if (productionReferences.length) referencedElsewhere++;
    else if (external.length) referencedOnlyFromTests++;
    else if (item.group === 'type-only') unreferencedTypeOnly.push(item);
    else bucketA.push(item);
  }
  return {
    filesScanned: sources.length,
    exportsScanned: exports.length,
    referencedElsewhere,
    referencedOnlyFromTests,
    unreferencedTypeOnly,
    bucketA,
    bucketB,
    bucketD,
    elapsedSeconds: (performance.now() - startedAt) / 1000,
  };
}

/** Candidate values ordered by how few distinct files carry them; scarcity is an ordering, never a cutoff. */
export function candidateValuesByScarcity(bucketB: BucketBReport): [string, number][] {
  const files = new Map<string, Set<string>>();
  for (const site of bucketB.sites) files.set(site.value, (files.get(site.value) ?? new Set()).add(site.file));
  return [...files].map(([value, carriers]) => [value, carriers.size] as [string, number])
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
}

function scarcestValues(bucketB: BucketBReport): [string, number][] {
  return candidateValuesByScarcity(bucketB).slice(0, 5);
}

/** ⭐⭐ Values whose every bypassing site sits in a test file.
 *
 *  📏 2026-08-22 (17th `[F]`): a human judged the five scarcest values and **four of them were
 *  deliberate test fixtures** — `FAKE_LAUNCHD` builds a fake input, and a log-category test names
 *  the category on purpose. Binding those to the constant would make the test follow the constant
 *  and stop catching the contract change it exists to catch.
 *  ⇒ 🔑 ***The sweep already knows this (`site.inTest`) — it just wasn't saying it where the human
 *  reads.*** Saying it in the scarcest line removes that judgement from the human's plate.
 *  ⛔ Test-only is a hint, never a verdict: a test copy can still be a real drift. */
function testOnlyValues(bucketB: BucketBReport): ReadonlySet<string> {
  const anyProd = new Set<string>();
  const all = new Set<string>();
  for (const site of bucketB.sites) {
    all.add(site.value);
    if (!site.inTest) anyProd.add(site.value);
  }
  return new Set([...all].filter((v) => !anyProd.has(v)));
}

function kindCounts(items: readonly ExportedSymbol[]): string {
  const counts = new Map<ExportKind, number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  return (['interface', 'type', 'function', 'const', 'class', 'enum'] as const).map((kind) => `${kind}=${counts.get(kind) ?? 0}`).join(', ');
}

export function formatF12Report(report: F12Report): string[] {
  return [
    `[f12-sweep] denominator: named exports=${report.exportsScanned}; files=${report.filesScanned}; ruler=TypeScript module-symbol exports (excluding default) in src TypeScript files`,
    `[f12-sweep] referenced elsewhere: ${report.referencedElsewhere}; ruler=TypeScript symbol reference in a non-defining, non-test file`,
    `[f12-sweep] referenced only from tests: ${report.referencedOnlyFromTests}; ruler=external TypeScript symbol references all located in test files`,
    `[f12-sweep] unreferenced type-only: ${report.unreferencedTypeOnly.length}; ruler=interface|type exports with no external TypeScript symbol reference; excluded from F12 defects; kinds=${kindCounts(report.unreferencedTypeOnly)}`,
    `[f12-sweep] bucket a unregistered: ${report.bucketA.length}; ruler=value exports (function|const|class|enum) with no external TypeScript symbol reference and no production registry registration; kinds=${kindCounts(report.bucketA)}`,
    `[f12-sweep] bucket b bypassed constant candidates: ${report.bucketB.sites.length}; ruler=string literal whose text equals the value of a string const exported from a different file; denominator=string literals ${report.bucketB.literalsScanned} in files ${report.bucketB.filesScanned} against exported string const values ${report.bucketB.constantsScanned}; scope=${report.bucketB.scanRoots.join(', ')}; unmeasured scopes=${report.bucketB.unavailableScopes.join(', ') || 'none'}; a shared value is a candidate and not a defect, because common vocabulary collides with constants that never governed it`,
    `[f12-sweep] bucket b scarcest candidate values: ${(() => {
      const testOnly = testOnlyValues(report.bucketB);
      return scarcestValues(report.bucketB)
        .map(([value, files]) => `${JSON.stringify(value)} in ${files} files${testOnly.has(value) ? ' [test-only]' : ''}`)
        .join('; ') || 'none';
    })()}; ruler=candidate values ordered by how few distinct files carry them, because a value carried by few files is more likely to be one contract than shared vocabulary; [test-only]=every bypassing site is in a test file, which is often a deliberate fixture rather than drift, but is a hint and not a verdict; list sites with --bucket-b`,
    `[f12-sweep] bucket b of which the declaring module is already imported: ${report.bucketB.sites.filter((site) => site.declaringModuleImported).length}; ruler=the bypassing file has an import declaration resolving to the file that exports the constant, so the import was available at that site`,
    `[f12-sweep] bucket b of which located in test files: ${report.bucketB.sites.filter((site) => site.inTest).length}; ruler=a test that copies the constant binds only its own side of the contract`,
    '[f12-sweep] bucket b remaining format mismatch: not-measured; ruler=payload-format compatibility beyond shared string constants requires runtime payload evidence, outside static export reachability',
    '[f12-sweep] bucket c injection absent: not-measured; ruler=dependency injection requires runtime composition evidence, outside static export reachability',
    `[f12-sweep] bucket d dynamically resolved: ${report.bucketD.length}; ruler=registered runtime IDs reached by production calls to registry.ts getToolRuntime (including alias resolution through findNativeTool); excluded from bucket a; kinds=${kindCounts(report.bucketD)}`,
    `[f12-sweep] elapsed: ${report.elapsedSeconds.toFixed(2)}s`,
  ];
}

if (import.meta.main) {
  const flags = new Set(['--strict', '--bucket-b']);
  const rootArg = process.argv.slice(2).find((argument) => !flags.has(argument));
  const root = resolve(rootArg ?? process.cwd());
  try {
    const report = await sweepF12(root);
    const lines = formatF12Report(report);
    lines[0] = `${lines[0]}; root=${root}`;
    for (const line of lines) console.log(line);
    if (process.argv.includes('--bucket-b')) {
      const sitesByValue = new Map<string, BypassedConstantSite[]>();
      for (const site of report.bucketB.sites) sitesByValue.set(site.value, [...(sitesByValue.get(site.value) ?? []), site]);
      for (const [value, carriers] of candidateValuesByScarcity(report.bucketB)) {
        console.log(`[f12-sweep] bucket b candidate ${JSON.stringify(value)}: ${carriers} files`);
        for (const site of sitesByValue.get(value) ?? []) {
          console.log(`[f12-sweep] bucket b   ${site.file}:${site.line}; const=${site.constName}; declared=${site.constFile}; declaring module already imported=${site.declaringModuleImported}; test=${site.inTest}`);
        }
      }
    }
    if (process.argv.includes('--strict') && report.bucketA.length > 0) process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/\s+/g, ' ') : String(error);
    console.log(`[f12-sweep] denominator: unavailable; root=${root}; ruler=TypeScript module-symbol exports (excluding default) in src TypeScript files`);
    console.log(`[f12-sweep] cannot measure root=${root}; reason=${message}`);
    process.exitCode = 1;
  }
}
