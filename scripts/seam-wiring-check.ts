#!/usr/bin/env bun

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { classifyFieldWiring, parseTypecheckErrors, tscEnv, type FieldWiringClassification } from '../src/typecheck-ratchet.js';

const EXIT_CODES = {
  wired: 0,
  unwired: 1,
  unread: 1,
  indeterminate: 2,
} as const;

type SeamWiringStatus = keyof typeof EXIT_CODES;

type SeamWiringTarget = {
  file: string;
  field: string;
};

type TscRun = {
  out: string;
  ran: boolean;
  why?: string;
};

type TscRunner = (cwd: string) => TscRun;

type SeamWiringResult = {
  target: SeamWiringTarget;
  status: SeamWiringStatus;
  exitCode: number;
  classification?: FieldWiringClassification;
  reason?: string;
};

type SeamWiringDependencies = {
  cwd?: string;
  runTsc?: TscRunner;
};

const USAGE = `Usage: bun scripts/seam-wiring-check.ts --file <repository-relative-file> --field <field>

Temporarily removes one declared field and substitutes its type with never in separate isolated repository copies, then typechecks each copy.
This tool runs two typechecks (typically about 80 seconds total, up from about 40 seconds for one run). It detects zero non-test injection sites and non-test injections with zero non-test reads; it cannot detect partial wiring, Object.assign wiring, or computed-key wiring.`;

function indeterminate(target: SeamWiringTarget, reason: string): SeamWiringResult {
  return { target, status: 'indeterminate', exitCode: EXIT_CODES.indeterminate, reason };
}

function isInside(root: string, path: string): boolean {
  const pathFromRoot = relative(root, path);
  return pathFromRoot !== '' && !pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot);
}

function fieldName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function findDeclaredField(source: ts.SourceFile, field: string): ts.PropertySignature | ts.PropertyDeclaration | null {
  const matches: Array<ts.PropertySignature | ts.PropertyDeclaration> = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) && fieldName(node.name) === field) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return matches.length === 1 ? matches[0]! : null;
}

function replaceDeclaredField(
  source: string,
  path: string,
  field: string,
  replacement: (declared: ts.PropertySignature | ts.PropertyDeclaration, parsed: ts.SourceFile) => string,
): { source?: string; reason?: string } {
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const declared = findDeclaredField(parsed, field);
  if (!declared) return { reason: `Expected exactly one declared field named ${JSON.stringify(field)} in ${path}.` };
  const start = declared.getStart(parsed);
  return { source: `${source.slice(0, start)}${replacement(declared, parsed)}${source.slice(declared.end)}` };
}

function removeDeclaredField(source: string, path: string, field: string): { source?: string; reason?: string } {
  return replaceDeclaredField(source, path, field, () => '');
}

function replaceDeclaredFieldTypeWithNever(source: string, path: string, field: string): { source?: string; reason?: string } {
  return replaceDeclaredField(source, path, field, (declared, parsed) => {
    const type = declared.type;
    if (!type) return parsed.text.slice(declared.getStart(parsed), declared.end);
    const typeStart = type.getStart(parsed);
    return `${parsed.text.slice(declared.getStart(parsed), typeStart)}never${parsed.text.slice(type.end, declared.end)}`;
  });
}

function copyRepository(root: string, temporaryRoot: string, name: string): string {
  const copy = join(temporaryRoot, name);
  cpSync(root, copy, {
    recursive: true,
    filter: (source) => !['.git', 'node_modules', '.elanous-test'].includes(basename(source)),
  });
  const dependencies = join(root, 'node_modules');
  if (existsSync(dependencies)) symlinkSync(dependencies, join(copy, 'node_modules'), 'dir');
  return copy;
}

/** Runs the repository's changed-file TypeScript configuration from an isolated copy. */
const defaultTscRunner: TscRunner = (cwd) => {
  const localTsc = join(cwd, 'node_modules', '.bin', 'tsc');
  const command = existsSync(localTsc) ? localTsc : 'npx';
  const args = command === 'npx' ? ['tsc', '--noEmit', '-p', 'tsconfig.gate.json'] : ['--noEmit', '-p', 'tsconfig.gate.json'];
  try {
    return { out: String(execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: tscEnv() }) ?? ''), ran: true };
  } catch (error: unknown) {
    const failure = error as { status?: number | null; signal?: string | null; code?: string; stdout?: string; stderr?: string };
    const out = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
    const ran = !failure.signal && (failure.status === 1 || failure.status === 2) && parseTypecheckErrors(out).length > 0;
    return {
      out,
      ran,
      ...(ran ? {} : { why: `tsc could not produce usable diagnostics (signal=${String(failure.signal)} code=${String(failure.code)} status=${String(failure.status)})` }),
    };
  }
};

/**
 * Removes one declared field only in a temporary repository copy, then classifies the resulting diagnostics.
 * The supplied original is read but never written.
 */
export function checkSeamWiring(target: SeamWiringTarget, dependencies: SeamWiringDependencies = {}): SeamWiringResult {
  const root = resolve(dependencies.cwd ?? process.cwd());
  if (!target.file || !target.field) return indeterminate(target, 'Both --file and --field are required.');
  if (!/^[A-Za-z_$][\w$]*$/.test(target.field)) return indeterminate(target, `Field must be a TypeScript identifier: ${target.field}.`);

  const original = resolve(root, target.file);
  if (!isInside(root, original)) return indeterminate(target, `Target file must be inside the repository: ${target.file}.`);
  if (!existsSync(original) || !lstatSync(original).isFile()) return indeterminate(target, `Target file does not exist: ${target.file}.`);

  const source = readFileSync(original, 'utf8');
  const deleted = removeDeclaredField(source, original, target.field);
  if (!deleted.source) return indeterminate(target, deleted.reason!);
  const neverSubstituted = replaceDeclaredFieldTypeWithNever(source, original, target.field);
  if (!neverSubstituted.source) return indeterminate(target, neverSubstituted.reason!);

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'elanous-seam-wiring-'));
  try {
    const deletionRepository = copyRepository(root, temporaryRoot, 'deletion-repository');
    const neverSubstitutionRepository = copyRepository(root, temporaryRoot, 'never-substitution-repository');
    const relativeTarget = relative(root, original);
    writeFileSync(join(deletionRepository, relativeTarget), deleted.source);
    writeFileSync(join(neverSubstitutionRepository, relativeTarget), neverSubstituted.source);
    const runTsc = dependencies.runTsc ?? defaultTscRunner;
    const deletionTsc = runTsc(deletionRepository);
    if (!deletionTsc.ran) return indeterminate(target, deletionTsc.why ?? 'deletion tsc did not run.');
    const neverSubstitutionTsc = runTsc(neverSubstitutionRepository);
    if (!neverSubstitutionTsc.ran) return indeterminate(target, neverSubstitutionTsc.why ?? 'never-substitution tsc did not run.');

    const classification = classifyFieldWiring(
      target.field,
      parseTypecheckErrors(deletionTsc.out),
      parseTypecheckErrors(neverSubstitutionTsc.out),
    );
    return {
      target,
      status: classification.status,
      exitCode: EXIT_CODES[classification.status],
      classification,
    };
  } catch (error: unknown) {
    return indeterminate(target, error instanceof Error ? error.message : String(error));
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function formatResult(result: SeamWiringResult): string {
  if (result.status === 'indeterminate') return `INDETERMINATE ${result.target.file}#${result.target.field} — ${result.reason}`;
  const { injectionSites, readSites } = result.classification!;
  const diagnosis = result.status === 'unwired'
    ? 'no non-test injection site'
    : result.status === 'unread'
      ? 'no non-test read site'
      : 'non-test injection and read sites present';
  return `${result.status.toUpperCase()} ${result.target.file}#${result.target.field} — ${diagnosis}; injections test=${injectionSites.test} nonTest=${injectionSites.nonTest}; reads test=${readSites.test} nonTest=${readSites.nonTest}`;
}

type MainIo = {
  log: (line: string) => void;
  error: (line: string) => void;
  runTsc?: TscRunner;
  cwd?: string;
};

function parseTarget(args: readonly string[]): SeamWiringTarget | null {
  const fileIndex = args.indexOf('--file');
  const fieldIndex = args.indexOf('--field');
  if (fileIndex < 0 || fieldIndex < 0 || !args[fileIndex + 1] || !args[fieldIndex + 1]) return null;
  return { file: args[fileIndex + 1]!, field: args[fieldIndex + 1]! };
}

/** Executable wrapper: emits one human-readable line followed by a JSON result. */
export function main(args = process.argv.slice(2), io: Partial<MainIo> = {}): number {
  const log = io.log ?? console.log;
  const error = io.error ?? console.error;
  if (args.includes('--help') || args.includes('-h')) {
    log(USAGE);
    return 0;
  }
  const target = parseTarget(args);
  if (!target) {
    error(USAGE);
    return EXIT_CODES.indeterminate;
  }
  const result = checkSeamWiring(target, { cwd: io.cwd, runTsc: io.runTsc });
  log(formatResult(result));
  log(JSON.stringify(result));
  return result.exitCode;
}

if (import.meta.main) process.exit(main());
