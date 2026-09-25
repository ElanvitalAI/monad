#!/usr/bin/env bun
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type Ts = typeof import('typescript');
type Symbol = import('typescript').Symbol;

export interface ExportedFunction { file: string; name: string; }
export interface UnwiredExportsReport { root: string; directory: string; filesScanned: number; exportsScanned: number; productionCalled: number; entrypointRegistered: number; blindSpots: { dynamicRequire: number; aliasReexport: number }; testOnly: ExportedFunction[]; unwired: ExportedFunction[]; }

function loadTypeScript(root: string): Promise<Ts> {
  const candidates = [resolve(root, 'node_modules/typescript/lib/typescript.js'), resolve(import.meta.dir, '../node_modules/typescript/lib/typescript.js')];
  const compiler = candidates.find(existsSync);
  if (!compiler) throw new Error(`TypeScript compiler dependency was not found; searched ${candidates.join(', ')}`);
  return import(pathToFileURL(compiler).href) as Promise<Ts>;
}
function isTypeScriptFile(file: string): boolean { return ['.ts', '.tsx'].some((suffix) => file.endsWith(suffix)) && !file.endsWith('.d.ts'); }
function isRepositoryFile(file: string): boolean { return ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].some((suffix) => file.endsWith(suffix)) && !file.endsWith('.d.ts'); }
function isTestFile(file: string): boolean { return /(?:^|[/\\])(test|tests|__tests__|__fixtures__)(?:[/\\]|$)|\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/.test(file); }
function isEntrypoint(file: string, root: string): boolean { const path = relative(root, file).replaceAll('\\', '/'); return path.startsWith('bin/') || path === 'src/index.ts'; }
function walkRepositoryFiles(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const file = resolve(dir, entry);
    if (statSync(file).isDirectory()) walkRepositoryFiles(file, files);
    else if (isRepositoryFile(file)) files.push(file);
  }
  return files;
}
function createProgram(ts: Ts, root: string, repositoryFiles: string[]): import('typescript').Program {
  const configPath = resolve(root, 'tsconfig.json');
  const fallbackOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true, skipLibCheck: true, allowJs: true, checkJs: false };
  if (!existsSync(configPath)) return ts.createProgram({ rootNames: repositoryFiles, options: fallbackOptions });
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath), { noEmit: true, allowJs: true, checkJs: false }, configPath);
  return ts.createProgram({ rootNames: [...new Set([...parsed.fileNames, ...repositoryFiles].map((file) => resolve(file)))], options: { ...parsed.options, allowJs: true, checkJs: false }, projectReferences: parsed.projectReferences });
}
function resolvedSymbol(ts: Ts, checker: import('typescript').TypeChecker, node: import('typescript').Node): Symbol | undefined { const symbol = checker.getSymbolAtLocation(node); return symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol; }
function callTargetSymbol(ts: Ts, checker: import('typescript').TypeChecker, expression: import('typescript').Expression): Symbol | undefined {
  if (ts.isPropertyAccessExpression(expression)) return resolvedSymbol(ts, checker, expression.name) ?? resolvedSymbol(ts, checker, expression);
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression) return resolvedSymbol(ts, checker, expression.argumentExpression) ?? resolvedSymbol(ts, checker, expression);
  return resolvedSymbol(ts, checker, expression);
}
function declarationFile(symbol: Symbol): string | undefined { return symbol.valueDeclaration?.getSourceFile().fileName ?? symbol.declarations?.[0]?.getSourceFile().fileName; }
function isCallableExport(ts: Ts, checker: import('typescript').TypeChecker, symbol: Symbol): boolean { const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]; return Boolean(symbol.flags & ts.SymbolFlags.Value && declaration && checker.getTypeOfSymbolAtLocation(symbol, declaration).getCallSignatures().length); }
function isRegistrationCall(ts: Ts, call: import('typescript').CallExpression): boolean { return ts.isPropertyAccessExpression(call.expression) && /^(action|command|register|handle|handler)$/.test(call.expression.name.text); }
type CallCounts = { production: number; test: number; registered: number };
function isModuleRequire(ts: Ts, checker: import('typescript').TypeChecker, expression: import('typescript').Expression): boolean {
  if (!ts.isIdentifier(expression) || expression.text !== 'require') return false;
  const symbol = checker.getSymbolAtLocation(expression);
  return !symbol?.declarations?.some((declaration) => !declaration.getSourceFile().isDeclarationFile && (
    ts.isParameter(declaration) || ts.isVariableDeclaration(declaration) || ts.isBindingElement(declaration) || ts.isFunctionDeclaration(declaration) || ts.isImportClause(declaration) || ts.isImportSpecifier(declaration) || ts.isNamespaceImport(declaration)
  ));
}
function isModuleImport(ts: Ts, expression: import('typescript').Expression): boolean { return expression.kind === ts.SyntaxKind.ImportKeyword; }
function isModuleRequest(ts: Ts, checker: import('typescript').TypeChecker, expression: import('typescript').Expression): boolean { return isModuleRequire(ts, checker, expression) || isModuleImport(ts, expression); }
function registrationCallbackPath(ts: Ts, expression: import('typescript').Expression): Set<import('typescript').Node> | undefined {
  const path = new Set<import('typescript').Node>();
  while (true) {
    path.add(expression);
    if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isParenthesizedExpression(expression) || ts.isNonNullExpression(expression) || ts.isSatisfiesExpression(expression)) expression = expression.expression;
    else break;
  }
  return ts.isArrowFunction(expression) || ts.isFunctionExpression(expression) ? path : undefined;
}
function staticModuleSpecifier(ts: Ts, checker: import('typescript').TypeChecker, expression: import('typescript').Expression): string | undefined {
  while (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isParenthesizedExpression(expression) || ts.isAwaitExpression(expression)) expression = expression.expression;
  if (!ts.isCallExpression(expression) || !isModuleRequest(ts, checker, expression.expression) || expression.arguments.length !== 1) return undefined;
  const [path] = expression.arguments;
  return path && ts.isStringLiteralLike(path) ? path.text : undefined;
}
function collectModuleBindings(ts: Ts, checker: import('typescript').TypeChecker, program: import('typescript').Program, source: import('typescript').SourceFile, callers: Map<Symbol, CallCounts>): { bindings: Map<Symbol, CallCounts>; dynamicRequire: number; aliasReexport: number } {
  const bindings = new Map<Symbol, CallCounts>(); let dynamicRequire = 0; let aliasReexport = 0;
  const visit = (node: import('typescript').Node): void => {
    if (ts.isCallExpression(node) && isModuleRequest(ts, checker, node.expression) && (node.arguments.length !== 1 || !ts.isStringLiteralLike(node.arguments[0]!))) dynamicRequire += 1;
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier) && node.exportClause && ts.isNamedExports(node.exportClause)) aliasReexport += node.exportClause.elements.filter((element) => Boolean(element.propertyName && element.propertyName.text !== element.name.text)).length;
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isObjectBindingPattern(node.name)) {
      const moduleName = staticModuleSpecifier(ts, checker, node.initializer);
      const resolved = moduleName && ts.resolveModuleName(moduleName, source.fileName, program.getCompilerOptions(), ts.sys).resolvedModule?.resolvedFileName;
      const moduleSource = resolved && program.getSourceFile(resolved); const module = moduleSource && checker.getSymbolAtLocation(moduleSource);
      if (module) for (const element of node.name.elements) {
        if (element.dotDotDotToken || element.propertyName && !ts.isIdentifier(element.propertyName) && !ts.isStringLiteralLike(element.propertyName)) continue;
        const exportedName = element.propertyName?.text ?? element.name.getText(source); const exported = checker.getExportsOfModule(module).find((symbol) => symbol.name === exportedName);
        const symbol = exported && (exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported); const candidate = symbol && callers.get(symbol);
        if (candidate && ts.isIdentifier(element.name)) bindings.set(resolvedSymbol(ts, checker, element.name)!, candidate);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { bindings, dynamicRequire, aliasReexport };
}

/** Scans exported TypeScript functions below directory, resolving TypeScript and JavaScript callers across the root. */
export async function sweepUnwiredExports(directoryArgument: string, rootArgument = process.cwd()): Promise<UnwiredExportsReport> {
  const root = resolve(rootArgument); const directory = resolve(root, directoryArgument); const ts = await loadTypeScript(root);
  const repositoryFiles = walkRepositoryFiles(root); const targetFiles = new Set(walkRepositoryFiles(directory).filter(isTypeScriptFile));
  const program = createProgram(ts, root, repositoryFiles); const checker = program.getTypeChecker(); const candidates = new Map<Symbol, ExportedFunction>();
  for (const source of program.getSourceFiles()) {
    if (!targetFiles.has(source.fileName) || isTestFile(source.fileName) || isEntrypoint(source.fileName, root)) continue;
    const module = checker.getSymbolAtLocation(source);
    if (!module) continue;
    for (const exported of checker.getExportsOfModule(module)) {
      const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      if (declarationFile(symbol) === source.fileName && isCallableExport(ts, checker, symbol)) candidates.set(symbol, { file: relative(root, source.fileName).replaceAll('\\', '/'), name: symbol.name });
    }
  }
  const callers = new Map([...candidates.keys()].map((symbol) => [symbol, { production: 0, test: 0, registered: 0 }]));
  let dynamicRequire = 0; let aliasReexport = 0;
  for (const source of program.getSourceFiles()) {
    if (source.isDeclarationFile || !repositoryFiles.includes(source.fileName)) continue;
    const moduleBindings = collectModuleBindings(ts, checker, program, source, callers); dynamicRequire += moduleBindings.dynamicRequire; aliasReexport += moduleBindings.aliasReexport;
    const visit = (node: import('typescript').Node, registeredEntrypointCallback = false, callbackRoot = false, activeCallbackPath?: Set<import('typescript').Node>): void => {
      const registered = registeredEntrypointCallback && (!ts.isFunctionLike(node) || callbackRoot);
      const registration = ts.isCallExpression(node) && isEntrypoint(source.fileName, root) && isRegistrationCall(ts, node);
      if (ts.isCallExpression(node)) {
        const symbol = callTargetSymbol(ts, checker, node.expression); const direct = symbol && callers.get(symbol); const count = direct ?? (symbol && moduleBindings.bindings.get(symbol));
        if (count && (!direct || declarationFile(symbol!) !== source.fileName)) {
          isTestFile(source.fileName) ? count.test += 1 : count.production += 1;
          if (registered) count.registered += 1;
        }
        if (registration) for (const argument of node.arguments) {
          const registeredSymbol = callTargetSymbol(ts, checker, argument); const registeredCount = registeredSymbol && callers.get(registeredSymbol);
          if (registeredCount && declarationFile(registeredSymbol) !== source.fileName) registeredCount.registered += 1;
        }
      }
      const callbackPath = registration ? new Set(node.arguments.flatMap((argument) => [...(registrationCallbackPath(ts, argument) ?? [])])) : activeCallbackPath;
      ts.forEachChild(node, (child) => {
        const inCallbackPath = callbackPath?.has(child) ?? false;
        visit(child, inCallbackPath || registered, ts.isFunctionLike(child) && inCallbackPath, callbackPath);
      });
    };
    visit(source);
  }
  const ordered = (items: ExportedFunction[]) => items.sort((a, b) => a.name.localeCompare(b.name)); const values = [...candidates.entries()]; const eligible = values.filter(([symbol]) => callers.get(symbol)!.registered === 0);
  return { root, directory, filesScanned: targetFiles.size, exportsScanned: eligible.length, productionCalled: eligible.filter(([symbol]) => callers.get(symbol)!.production > 0).length, entrypointRegistered: values.filter(([symbol]) => callers.get(symbol)!.registered > 0).length, blindSpots: { dynamicRequire, aliasReexport }, testOnly: ordered(eligible.filter(([symbol]) => { const count = callers.get(symbol)!; return count.production === 0 && count.test > 0; }).map(([, item]) => item)), unwired: ordered(eligible.filter(([symbol]) => { const count = callers.get(symbol)!; return count.production === 0 && count.test === 0; }).map(([, item]) => item)) };
}
function formatList(label: string, items: ExportedFunction[]): string { return `[unwired-exports] ${label}: ${items.length}${items.length ? `; ${items.map((item) => `${item.file}:${item.name}`).join(', ')}` : ''}`; }
export function formatUnwiredExportsReport(report: UnwiredExportsReport): string[] { return [`[unwired-exports] scanned: files=${report.filesScanned}; exported functions=${report.exportsScanned}; production-called=${report.productionCalled}; entrypoint-registered=${report.entrypointRegistered}${report.entrypointRegistered === 0 ? ' (none found: this can be normal or indicate missed self-wiring)' : ''}; root=${report.root}`, formatList('testOnly', report.testOnly), formatList('unwired', report.unwired), `[unwired-exports] blindSpots: dynamic-require=${report.blindSpots.dynamicRequire}; alias-reexport=${report.blindSpots.aliasReexport}`]; }
export async function main(args = process.argv.slice(2)): Promise<void> {
  const directory = args[0] ?? process.cwd();
  if (directory.startsWith('-')) {
    console.log(`[unwired-exports] unknown flag: ${directory}`);
    process.exitCode = 1;
    return;
  }
  const report = await sweepUnwiredExports(directory);
  if (report.filesScanned === 0) {
    console.log(`[unwired-exports] nothing was measured; directory=${report.directory} root=${report.root}`);
    process.exitCode = 1;
    return;
  }
  console.log(formatUnwiredExportsReport(report).join('\n'));
}
if (import.meta.main) main().catch((error: unknown) => console.log(`[unwired-exports] unavailable: ${error instanceof Error ? error.message : String(error)}`));
