import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

export const LEDGER_CHECKS = ['status-vocab', 'four-lines', 'linkage'] as const;

export type LedgerCheckName = (typeof LEDGER_CHECKS)[number];
export type LedgerEntryStatus = 'open' | 'fixed' | 'withdrawn';
export type LedgerDeclarationKind = 'failure' | 'improvement';

export interface LedgerEntry {
  file: string;
  title: string;
  body: string;
  status?: LedgerEntryStatus;
  declaration?: {
    id: string;
    kind: LedgerDeclarationKind;
  };
  references: string[];
}

export interface LedgerViolation {
  file: string;
  title: string;
  check: LedgerCheckName;
}

export interface LedgerLintResult {
  entries: LedgerEntry[];
  violations: LedgerViolation[];
  unremediatedFailures: LedgerEntry[];
  counts: {
    total: number;
    violations: number;
    byCheck: Record<LedgerCheckName, number>;
  };
}

const STATUS = /\*\*\s*(open|fixed|withdrawn)\b/i;
const DECLARATION = /^(F-?\d+|I-(?:[A-Z]\d+|\d+))\b/i;
const REFERENCE = /\b(F-?\d+|I-(?:[A-Z]\d+|\d+))\b/gi;

function normalizeId(id: string): string {
  const upper = id.toUpperCase();
  const failure = upper.match(/^F-?(\d+)$/);
  return failure ? `F-${failure[1]}` : upper;
}

function referencesIn(text: string): string[] {
  return [...new Set([...text.matchAll(REFERENCE)].map((match) => normalizeId(match[1]!)))];
}

export function parseLedgerDocument(file: string, document: string): LedgerEntry[] {
  const headings = [...document.matchAll(/^### (.+)$/gm)];
  return headings.map((heading, index) => {
    const title = heading[1]!.trim();
    const bodyStart = heading.index! + heading[0].length;
    const bodyEnd = headings[index + 1]?.index ?? document.length;
    const body = document.slice(bodyStart, bodyEnd).trim();
    const statusMatch = title.match(STATUS);
    const declarationMatch = title.match(DECLARATION);
    const declarationId = declarationMatch ? normalizeId(declarationMatch[1]!) : undefined;
    const references = referencesIn(`${title}\n${body}`).filter((id) => id !== declarationId);

    return {
      file,
      title,
      body,
      status: statusMatch?.[1]?.toLowerCase() as LedgerEntryStatus | undefined,
      declaration: declarationId
        ? { id: declarationId, kind: declarationId.startsWith('F-') ? 'failure' : 'improvement' }
        : undefined,
      references,
    };
  });
}

function collectLedgerFiles(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  const files: string[] = [];
  for (const dirent of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, dirent.name);
    if (dirent.isDirectory()) files.push(...collectLedgerFiles(child));
    else if (dirent.isFile() && basename(child) === 'ISSUES.md') files.push(child);
  }
  return files.sort();
}

export function lintLedgerEntries(entries: readonly LedgerEntry[]): LedgerLintResult {
  const declarations = new Map<string, LedgerEntry[]>();
  for (const entry of entries) {
    if (!entry.declaration) continue;
    const declarationsForId = declarations.get(entry.declaration.id) ?? [];
    declarationsForId.push(entry);
    declarations.set(entry.declaration.id, declarationsForId);
  }

  const violationChecks = new Map<LedgerEntry, Set<LedgerCheckName>>();
  const violations: LedgerViolation[] = [];
  const addViolation = (entry: LedgerEntry, check: LedgerCheckName): void => {
    const checks = violationChecks.get(entry) ?? new Set<LedgerCheckName>();
    if (checks.has(check)) return;
    checks.add(check);
    violationChecks.set(entry, checks);
    violations.push({ file: entry.file, title: entry.title, check });
  };

  for (const entry of entries) {
    if (!entry.status) addViolation(entry, 'status-vocab');
    if (!entry.body.includes('**근본**') || !entry.body.includes('**근거**')) addViolation(entry, 'four-lines');
    if (entry.references.length === 0) addViolation(entry, 'linkage');
  }

  for (const duplicateEntries of declarations.values()) {
    if (duplicateEntries.length < 2) continue;
    for (const entry of duplicateEntries) addViolation(entry, 'linkage');
  }

  const failures = entries.filter((entry) => entry.declaration?.kind === 'failure');
  const unremediatedFailures: LedgerEntry[] = [];
  for (const failure of failures) {
    const failureId = failure.declaration!.id;
    const failureIsUnique = declarations.get(failureId)?.length === 1;
    const validImprovement = failure.references.some((improvementId) => {
      if (!improvementId.startsWith('I-')) return false;
      const candidates = declarations.get(improvementId);
      if (!failureIsUnique || candidates?.length !== 1) return false;
      const improvement = candidates[0]!;
      return improvement.declaration?.kind === 'improvement'
        && improvement.status === 'fixed'
        && improvement.references.includes(failureId);
    });
    if (!validImprovement) {
      unremediatedFailures.push(failure);
      if (failure.references.some((id) => id.startsWith('I-'))) addViolation(failure, 'linkage');
    }
  }

  violations.sort((a, b) => a.file.localeCompare(b.file) || a.title.localeCompare(b.title) || a.check.localeCompare(b.check));
  const byCheck = Object.fromEntries(LEDGER_CHECKS.map((check) => [check, violations.filter((violation) => violation.check === check).length])) as Record<LedgerCheckName, number>;
  return {
    entries: [...entries],
    violations,
    unremediatedFailures,
    counts: { total: entries.length, violations: violations.length, byCheck },
  };
}

export function lintLedgerDirectory(path = 'docs/harness'): LedgerLintResult {
  const entries = collectLedgerFiles(path).flatMap((file) => parseLedgerDocument(file, readFileSync(file, 'utf8')));
  return lintLedgerEntries(entries);
}

export function renderLedgerLint(result: LedgerLintResult): string {
  const lines = result.violations.map(({ file, title, check }) => `${file}:${title.slice(0, 40)} ${check}`);
  lines.push(
    `summary total=${result.counts.total} status-vocab=${result.counts.byCheck['status-vocab']} four-lines=${result.counts.byCheck['four-lines']} linkage=${result.counts.byCheck.linkage} violations=${result.counts.violations} unremediated=${result.unremediatedFailures.length}`,
  );
  return lines.join('\n');
}

export function runLedgerLint(path = 'docs/harness', strict = false): { output: string; exitCode: number; result: LedgerLintResult } {
  const result = lintLedgerDirectory(path);
  return {
    output: renderLedgerLint(result),
    exitCode: strict && result.violations.length > 0 ? 1 : 0,
    result,
  };
}
