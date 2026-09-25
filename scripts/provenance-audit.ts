import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';

export type AuditProvenanceOptions = {
  readonly referenceRoot: string;
  readonly repositoryRoot?: string;
};

export type ProvenanceJustificationReason = 'spec' | 'os-tool' | 'idiom';

export type ProvenanceJustifiedOverlap = {
  readonly symbol: string;
  readonly reason: ProvenanceJustificationReason;
};

export type ProvenanceUnmeasured = {
  readonly reason: string;
};

export type ProvenanceAuditResult = {
  readonly overlappingSymbols: readonly string[];
  readonly justified: readonly ProvenanceJustifiedOverlap[];
  readonly unjustified: readonly string[];
  readonly unmeasured: readonly ProvenanceUnmeasured[];
};

/**
 * One in-file table. A shared exported name lands in `justified` only when it
 * is listed here; every other overlap stays in `unjustified`.
 */
const JUSTIFICATION_TABLE: Readonly<Record<string, ProvenanceJustificationReason>> = {
  code_verifier: 'spec',
  PKCE: 'spec',
  'WWW-Authenticate': 'spec',
  resource_metadata: 'spec',
  arecord: 'os-tool',
  ALSA: 'os-tool',
};

const sourceFile = /\.[cm]?[jt]sx?$/;

function repositorySourceRoot(root: string): string {
  const nestedSource = join(root, 'src');
  if (!existsSync(nestedSource)) throw new Error(`Repository source directory does not exist: ${nestedSource}`);
  return nestedSource;
}

function referenceSourceRoot(root: string): string {
  const nestedSource = join(root, 'src');
  return existsSync(nestedSource) ? nestedSource : root;
}

function filesIn(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (sourceFile.test(entry.name)) files.push(path);
    }
  };
  visit(root);
  return files.sort();
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);
}

function isExported(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.ExportKeyword);
}

function isDefaultExport(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.DefaultKeyword);
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  const names: string[] = [];
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) names.push(...bindingNames(element.name));
  }
  return names;
}

function exportedSymbols(filePath: string): Set<string> {
  const source = ts.createSourceFile(filePath, readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true);
  const symbols = new Set<string>();
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause) {
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) symbols.add(element.name.text);
      } else if (ts.isNamespaceExport(statement.exportClause)) {
        symbols.add(statement.exportClause.name.text);
      }
      continue;
    }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      symbols.add('default');
      continue;
    }
    if (!isExported(statement)) continue;
    if (isDefaultExport(statement)) {
      symbols.add('default');
      continue;
    }
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) && statement.name) {
      symbols.add(statement.name.text);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of bindingNames(declaration.name)) symbols.add(name);
      }
    }
  }
  return symbols;
}

function symbolsIn(root: string): Set<string> {
  const symbols = new Set<string>();
  for (const filePath of filesIn(root)) {
    for (const symbol of exportedSymbols(filePath)) symbols.add(symbol);
  }
  return symbols;
}

function unmeasured(reason: string): ProvenanceAuditResult {
  return {
    overlappingSymbols: [],
    justified: [],
    unjustified: [],
    unmeasured: [{ reason }],
  };
}

function splitOverlap(overlappingSymbols: readonly string[]): Pick<ProvenanceAuditResult, 'justified' | 'unjustified'> {
  const justified: ProvenanceJustifiedOverlap[] = [];
  const unjustified: string[] = [];
  for (const symbol of overlappingSymbols) {
    const reason = JUSTIFICATION_TABLE[symbol];
    if (reason === undefined) unjustified.push(symbol);
    else justified.push({ symbol, reason });
  }
  return { justified, unjustified };
}

export function auditProvenance(options: AuditProvenanceOptions): ProvenanceAuditResult {
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd());
  let repositorySymbols: Set<string>;
  try {
    repositorySymbols = symbolsIn(repositorySourceRoot(repositoryRoot));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Repository source directory does not exist:')) throw error;
    return unmeasured(error instanceof Error ? error.message : String(error));
  }

  const referenceRoot = resolve(options.referenceRoot);
  if (!existsSync(referenceRoot)) {
    return unmeasured(`Reference tree does not exist: ${referenceRoot}`);
  }
  let referenceSymbols: Set<string>;
  try {
    referenceSymbols = symbolsIn(referenceSourceRoot(referenceRoot));
  } catch (error) {
    return unmeasured(error instanceof Error ? error.message : String(error));
  }

  const overlappingSymbols = [...repositorySymbols].filter((symbol) => referenceSymbols.has(symbol)).sort();
  return {
    overlappingSymbols,
    ...splitOverlap(overlappingSymbols),
    unmeasured: [],
  };
}

function flagValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) return undefined;
  return value;
}

function exitCode(result: ProvenanceAuditResult): number {
  if (result.unmeasured.length > 0) return 2;
  if (result.unjustified.length > 0) return 1;
  return 0;
}

function runCli(argv: readonly string[]): number {
  const referenceRoot = flagValue(argv, '--ref');
  if (referenceRoot === undefined) {
    process.stderr.write('provenance-audit: --ref <path> is required\n');
    return 2;
  }
  const result = auditProvenance({ referenceRoot });
  if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(result)}\n`);
  return exitCode(result);
}

if (import.meta.main) {
  process.exit(runCli(process.argv.slice(2)));
}
