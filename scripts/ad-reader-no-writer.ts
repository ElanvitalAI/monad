#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import ts from 'typescript';

const ROOT = join(import.meta.dir, '..');
const BASELINE = join(import.meta.dir, 'ad-reader-no-writer-baseline.txt');
const SCAN_ROOTS = ['src/ad-pipeline', 'src/product-grounding', 'src/dashboard/ad-slash-runtime.ts'];
const KNOWN_SUSPECTS = ['negativePromptPresent', 'safeAreaViolations'] as const;
const KNOWN_SUPPLIED = ['collectGroundingFacts', 'copyProvenance', 'qc', 'detectedTextRegions', 'raw'] as const;

export type FieldCounts = { reads: number; productionSupplies: number; testSupplies: number };
export type AuditReport = { fields: ReadonlyMap<string, FieldCounts>; suspects: string[]; blindSpots: { spreadSupplied: number; consumerFiles: number } };
type SourceInput = { path: string; text: string; test: boolean };
type AuditIo = { args?: readonly string[]; root?: string; sources?: readonly SourceInput[]; baseline?: ReadonlySet<string>; writeBaseline?: (names: readonly string[]) => void; log?: (line: string) => void; error?: (line: string) => void };

function walk(path: string, files: string[]): void {
  const stat = statSync(path);
  if (!stat.isDirectory()) { if (path.endsWith('.ts')) files.push(path); return; }
  for (const entry of readdirSync(path)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    walk(join(path, entry), files);
  }
}

function repositorySources(root: string): SourceInput[] {
  const scanFiles: string[] = [];
  for (const scanRoot of SCAN_ROOTS) walk(join(root, scanRoot), scanFiles);
  const sourceFiles: string[] = [];
  walk(join(root, 'src'), sourceFiles);
  const scanPaths = new Set(scanFiles.map(path => relative(root, path)));
  const consumers = sourceFiles.filter(path => !/\.test\.ts$/.test(path) && !scanPaths.has(relative(root, path)) && importsScanRoot(relative(root, path), readFileSync(path, 'utf8'), scanPaths));
  const testFiles: string[] = [];
  walk(join(root, 'test'), testFiles);
  const files = [...scanFiles, ...consumers, ...testFiles.filter(path => /\/ad-[^/]+\.test\.ts$/.test(path))];
  return files.sort().map(path => ({ path: relative(root, path), text: readFileSync(path, 'utf8'), test: /\.test\.ts$/.test(path) }));
}

function importsScanRoot(path: string, text: string, scanPaths: ReadonlySet<string>): boolean {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  return source.statements.some(statement => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return false;
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith('.')) return false;
    const resolved = posix.normalize(posix.join(posix.dirname(path), specifier)).replace(/\.js$/, '.ts');
    return scanPaths.has(resolved);
  });
}

function isScanRootPath(path: string): boolean {
  return SCAN_ROOTS.some(scanRoot => path === scanRoot || path.startsWith(`${scanRoot}/`));
}

function consumerPaths(sources: readonly SourceInput[]): Set<string> {
  const scanPaths = new Set(sources.filter(source => !source.test && isScanRootPath(source.path)).map(source => source.path));
  return new Set(sources.filter(source => !source.test && !isScanRootPath(source.path) && importsScanRoot(source.path, source.text, scanPaths)).map(source => source.path));
}

function count(fields: Map<string, FieldCounts>, name: string, key: keyof FieldCounts): void {
  const current = fields.get(name) ?? { reads: 0, productionSupplies: 0, testSupplies: 0 };
  current[key] += 1;
  fields.set(name, current);
}

function propertyName(name: ts.PropertyName): string | null {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : null;
}

export function scanSources(sources: readonly SourceInput[]): AuditReport {
  const fields = new Map<string, FieldCounts>();
  const consumers = consumerPaths(sources);
  let spreadSupplied = 0;
  for (const input of sources) {
    const scanRoot = isScanRootPath(input.path);
    if (!input.test && !scanRoot && !consumers.has(input.path)) continue;
    const source = ts.createSourceFile(input.path, input.text, ts.ScriptTarget.Latest, true);
    const supplyKey: keyof FieldCounts = input.test ? 'testSupplies' : 'productionSupplies';
    const countReads = !input.test && scanRoot;
    const visit = (node: ts.Node): void => {
      if (countReads && ts.isPropertyAccessExpression(node)) count(fields, node.name.text, 'reads');
      if (countReads && ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) count(fields, node.argumentExpression.text, 'reads');
      if (ts.isObjectLiteralExpression(node)) {
        for (const property of node.properties) {
          if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
            const name = propertyName(property.name);
            if (name) count(fields, name, supplyKey);
          } else if (ts.isSpreadAssignment(property) && ts.isIdentifier(property.expression)) spreadSupplied += 1;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  const suspects = [...fields.entries()]
    .filter(([, field]) => field.reads >= 2 && field.productionSupplies === 0 && field.testSupplies > 0)
    .map(([name]) => name).sort();
  return { fields, suspects, blindSpots: { spreadSupplied, consumerFiles: consumers.size } };
}

export function selfCheck(report: AuditReport): string | null {
  const missingSuspects = KNOWN_SUSPECTS.filter(name => !report.suspects.includes(name));
  const falselySuspect = KNOWN_SUPPLIED.filter(name => report.suspects.includes(name));
  const unsupplied = KNOWN_SUPPLIED.filter(name => (report.fields.get(name)?.productionSupplies ?? 0) === 0);
  if (!missingSuspects.length && !falselySuspect.length && !unsupplied.length) return null;
  return `[ad-reader-no-writer] SELF-CHECK FAIL — missing suspects: ${missingSuspects.join(', ') || 'none'}; false suspects: ${falselySuspect.join(', ') || 'none'}; known production supplies missing: ${unsupplied.join(', ') || 'none'}.`;
}

function loadBaseline(root: string): Set<string> {
  const path = join(root, 'scripts', 'ad-reader-no-writer-baseline.txt');
  if (!existsSync(path)) return new Set();
  return new Set(readFileSync(path, 'utf8').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#')));
}

function writeBaseline(names: readonly string[]): void {
  writeFileSync(BASELINE, ['# Ad reader/no-writer suspect baseline.', '# New suspect names fail; resolved names are allowed until --update ratchets this snapshot.', ...names].join('\n') + '\n');
}

export function renderReport(report: AuditReport): string {
  const counts = report.suspects.map(name => {
    const field = report.fields.get(name)!;
    return `${name}: reads ${field.reads} · production supplies ${field.productionSupplies} · test supplies ${field.testSupplies}`;
  });
  return [`ad-reader-no-writer · suspects ${report.suspects.length}${report.suspects.length ? ` · ${report.suspects.join(', ')}` : ''}`, `blindSpots: { spreadSupplied: ${report.blindSpots.spreadSupplied}, consumerFiles: ${report.blindSpots.consumerFiles} }`, ...counts].join('\n');
}

export function runAdReaderNoWriter(io: AuditIo = {}): number {
  const args = io.args ?? process.argv.slice(2);
  const log = io.log ?? console.log;
  const error = io.error ?? console.error;
  const root = io.root ?? ROOT;
  const report = scanSources(io.sources ?? repositorySources(root));
  const selfCheckFailure = selfCheck(report);
  if (selfCheckFailure) { error(selfCheckFailure); return 1; }
  if (args.includes('--update')) {
    (io.writeBaseline ?? writeBaseline)(report.suspects);
    log(`[ad-reader-no-writer] baseline updated — ${report.suspects.length} suspect names.`);
    return 0;
  }
  const baseline = io.baseline ?? loadBaseline(root);
  const newNames = report.suspects.filter(name => !baseline.has(name));
  if (newNames.length) { error(`[ad-reader-no-writer] FAIL — new suspect names: ${newNames.join(', ')}.`); return 1; }
  log(renderReport(report));
  return 0;
}

if (import.meta.main) process.exit(runAdReaderNoWriter());
