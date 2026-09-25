import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const ROOT = join(import.meta.dir, '..');
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

type PackageJson = {
  devDependencies?: Record<string, string>;
  files?: string[];
};

export type ShippedFile = {
  file: string;
  text: string;
};

export type ShippedDevDepViolation = {
  dependency: string;
  file: string;
  line: number;
  text: string;
};

export type ShippedDevDepResult = {
  violations: ShippedDevDepViolation[];
  scannedFileCount: number;
  devDependencyNames: string[];
  measurementFailure: string | null;
};

export type ShippedDevDepOptions = {
  cwd?: string;
  packageJson?: PackageJson;
  shippedFiles?: readonly ShippedFile[];
};

type ShippedDevDepGateIo = ShippedDevDepOptions & {
  log?: (message: string) => void;
  error?: (message: string) => void;
  check?: (options: ShippedDevDepOptions) => ShippedDevDepResult;
};

function loadPackageJson(root: string): PackageJson | null {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageJson;
  } catch {
    return null;
  }
}

function sourceFilesMatching(root: string, pattern: string): string[] {
  const normalized = pattern.replace(/^\.\//, '');
  const path = join(root, normalized.replace(/\/$/, ''));
  const matchedPaths = existsSync(path)
    ? [normalized]
    : (() => {
      try {
        return [...new Bun.Glob(normalized).scanSync({ cwd: root, onlyFiles: false, dot: true })];
      } catch {
        throw new Error(`unsupported package.json files pattern: ${pattern}`);
      }
    })();
  const sourceFiles = new Set<string>();
  for (const matchedPath of matchedPaths) {
    const fullPath = join(root, matchedPath);
    const status = statSync(fullPath);
    if (status.isFile()) {
      if (SOURCE_FILE.test(matchedPath)) sourceFiles.add(matchedPath);
      continue;
    }
    if (status.isDirectory()) {
      for (const file of new Bun.Glob(`${matchedPath.replace(/\/$/, '')}/**/*`).scanSync({ cwd: root, onlyFiles: true, dot: true })) {
        if (SOURCE_FILE.test(file)) sourceFiles.add(file);
      }
    }
  }
  return [...sourceFiles];
}

function defaultShippedFiles(root: string, packageJson: PackageJson): ShippedFile[] {
  const entries = packageJson.files;
  if (!entries || entries.length === 0) throw new Error('package.json files contract is missing or empty');
  const included = new Set<string>();
  const excluded = new Set<string>();
  try {
    for (const entry of entries) {
      if (!entry) throw new Error('package.json files contains an empty pattern');
      const matches = sourceFilesMatching(root, entry.startsWith('!') ? entry.slice(1) : entry);
      const target = entry.startsWith('!') ? excluded : included;
      for (const file of matches) target.add(file);
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
  return [...included]
    .filter(file => !excluded.has(file))
    .sort()
    .map(file => ({ file, text: readFileSync(join(root, file), 'utf8') }));
}

function matchesDependency(specifier: string, dependency: string): boolean {
  return specifier === dependency || specifier.startsWith(`${dependency}/`);
}

function namedBindingsAreTypeOnly(namedBindings: ts.NamedImportBindings | undefined): boolean {
  return !!namedBindings
    && ts.isNamedImports(namedBindings)
    && namedBindings.elements.length > 0
    && namedBindings.elements.every(element => element.isTypeOnly);
}

function exportClauseIsTypeOnly(exportClause: ts.NamedExportBindings | undefined): boolean {
  return !!exportClause
    && ts.isNamedExports(exportClause)
    && exportClause.elements.length > 0
    && exportClause.elements.every(element => element.isTypeOnly);
}

function importHasRuntimeValue(declaration: ts.ImportDeclaration): boolean {
  const clause = declaration.importClause;
  return !clause || (!clause.isTypeOnly && (!!clause.name || !namedBindingsAreTypeOnly(clause.namedBindings)));
}

function exportHasRuntimeValue(declaration: ts.ExportDeclaration): boolean {
  return !declaration.isTypeOnly && !exportClauseIsTypeOnly(declaration.exportClause);
}

function sourceTextLine(source: string, position: number): { line: number; text: string } {
  const before = source.slice(0, position);
  const line = before.split('\n').length;
  return { line, text: source.split('\n')[line - 1] ?? '' };
}

function scanFile(file: ShippedFile, dependencies: readonly string[]): ShippedDevDepViolation[] {
  const sourceFile = ts.createSourceFile(file.file, file.text, ts.ScriptTarget.Latest, true);
  const violations: ShippedDevDepViolation[] = [];
  const record = (specifier: string, node: ts.Node): void => {
    const dependency = dependencies.find(candidate => matchesDependency(specifier, candidate));
    if (!dependency) return;
    const { line, text } = sourceTextLine(file.text, node.getStart(sourceFile));
    violations.push({ dependency, file: file.file, line, text });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && importHasRuntimeValue(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      record(node.moduleSpecifier.text, node);
    } else if (ts.isExportDeclaration(node) && exportHasRuntimeValue(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      record(node.moduleSpecifier.text, node);
    } else if (ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'require'
      && node.arguments.length >= 1
      && ts.isStringLiteral(node.arguments[0]!)) {
      record(node.arguments[0]!.text, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

/** Scans package.json's actual devDependency names against shipped value imports. */
export function checkShippedDevDependencies(options: ShippedDevDepOptions = {}): ShippedDevDepResult {
  const root = options.cwd ?? ROOT;
  const packageJson = options.packageJson ?? loadPackageJson(root);
  if (!packageJson) {
    return { violations: [], scannedFileCount: 0, devDependencyNames: [], measurementFailure: 'package.json could not be read' };
  }

  const devDependencyNames = Object.keys(packageJson.devDependencies ?? {}).sort();
  let shippedFiles: readonly ShippedFile[];
  try {
    shippedFiles = options.shippedFiles ?? defaultShippedFiles(root, packageJson);
  } catch (error) {
    return {
      violations: [],
      scannedFileCount: 0,
      devDependencyNames,
      measurementFailure: error instanceof Error ? error.message : String(error),
    };
  }
  if (shippedFiles.length === 0) {
    return { violations: [], scannedFileCount: 0, devDependencyNames, measurementFailure: 'no shipped source files were scanned' };
  }

  return {
    violations: shippedFiles.flatMap(file => scanFile(file, devDependencyNames)),
    scannedFileCount: shippedFiles.length,
    devDependencyNames,
    measurementFailure: null,
  };
}

/** CLI entrypoint runner; import.meta.main invokes this function. */
export function runShippedDevDepGate(io: ShippedDevDepGateIo = {}): number {
  const log = io.log ?? console.log;
  const error = io.error ?? console.error;
  const result = (io.check ?? checkShippedDevDependencies)(io);
  log(`[shipped-devdep-gate] scanned ${result.scannedFileCount} file(s); ${result.devDependencyNames.length} devDependency name(s).`);
  if (result.measurementFailure) {
    error(`[shipped-devdep-gate] FAIL — measurement failure: ${result.measurementFailure}`);
    return 1;
  }
  if (result.violations.length > 0) {
    error('[shipped-devdep-gate] FAIL — shipped source imports devDependencies at runtime.');
    for (const violation of result.violations) {
      error(`  ${violation.file}:${violation.line} ${violation.dependency} — ${violation.text.trim()}`);
    }
    return 1;
  }
  log('[shipped-devdep-gate] PASS — no shipped runtime devDependency imports.');
  return 0;
}

if (import.meta.main) process.exit(runShippedDevDepGate());
