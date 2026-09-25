import { readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { parseGoalAuthorParent, parseGoalDocumentClarifications } from './goal-author-clarification.js';
import { isGoalAuthorFileName } from './goal-document.js';

export interface GoalClarificationClosureEntry {
  path: string;
  pending: number;
}

export interface GoalClarificationClosure {
  start: GoalClarificationClosureEntry;
  descendants: GoalClarificationClosureEntry[];
  documents: number;
  pending: number;
  status: 'closed' | 'open';
}

export type GoalInterviewRoundStatus = 'converged' | 'narrowed' | 'stalled';

function unresolvedClarificationCount(document: string): number {
  return parseGoalDocumentClarifications(document).filter((clarification) => !clarification.answered).length;
}

function persistentGroundingEvidenceCount(document: string): number {
  const lines = document.split(/\r?\n/);
  const heading = lines.findIndex((line) => /^(?:- )?Persistent grounding evidence\b/.test(line));
  if (heading < 0) return 0;

  let count = 0;
  for (const line of lines.slice(heading + 1)) {
    if (!/^  - /.test(line)) break;
    count += 1;
  }
  return count;
}

/** Classify whether an interview round resolved, narrowed, or stalled its goal-document uncertainty. */
export function classifyGoalInterviewRound(previousDocument: string, nextDocument: string): GoalInterviewRoundStatus {
  const previousUnresolved = unresolvedClarificationCount(previousDocument);
  const nextUnresolved = unresolvedClarificationCount(nextDocument);
  if (nextUnresolved === 0) return 'converged';
  if (nextUnresolved < previousUnresolved) return 'narrowed';
  if (nextUnresolved === previousUnresolved
    && persistentGroundingEvidenceCount(nextDocument) < persistentGroundingEvidenceCount(previousDocument)) return 'narrowed';
  return 'stalled';
}

function normalizeRepositoryPath(path: string): string {
  return normalize(path).split(sep).join('/').replace(/^\.\//, '');
}

function goalFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return goalFiles(path);
      return entry.isFile() && isGoalAuthorFileName(entry.name) ? [path] : [];
    })
    .sort();
}

function clarificationEntry(path: string, document: string): GoalClarificationClosureEntry {
  return {
    path,
    pending: parseGoalDocumentClarifications(document).filter((clarification) => !clarification.answered).length,
  };
}

/** Collect every descendant whose Parent provenance names the start goal or another collected descendant. */
export function collectGoalClarificationClosure(goalFile: string, directory: string): GoalClarificationClosure {
  if (isAbsolute(goalFile)) throw new Error('closure goal file must be repository-relative');
  const absoluteDirectory = resolve(directory);
  const startPath = normalizeRepositoryPath(goalFile);
  const files = goalFiles(absoluteDirectory);
  const startAbsolutePath = files.find((path) => normalizeRepositoryPath(path).endsWith(`/${startPath}`));
  if (startAbsolutePath === undefined) throw new Error(`closure goal file not found: ${goalFile}`);
  const repositoryRoot = resolve(startAbsolutePath, ...startPath.split('/').map(() => '..'));
  const documents = new Map(files.map((path) => [
    normalizeRepositoryPath(relative(repositoryRoot, path)),
    readFileSync(path, 'utf8'),
  ]));
  const startDocument = documents.get(startPath);
  if (startDocument === undefined) throw new Error(`closure goal file not found: ${goalFile}`);

  const children = new Map<string, string[]>();
  for (const [path, document] of documents) {
    const parent = parseGoalAuthorParent(document);
    if (!parent) continue;
    const parentPath = normalizeRepositoryPath(parent.goalFile);
    const paths = children.get(parentPath) ?? [];
    paths.push(path);
    children.set(parentPath, paths);
  }

  const seen = new Set([startPath]);
  const pendingPaths = [...(children.get(startPath) ?? [])];
  const descendants: GoalClarificationClosureEntry[] = [];
  while (pendingPaths.length > 0) {
    const path = pendingPaths.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    const document = documents.get(path);
    if (document === undefined) continue;
    descendants.push(clarificationEntry(path, document));
    pendingPaths.push(...(children.get(path) ?? []));
  }

  const pending = descendants.reduce((total, entry) => total + entry.pending, 0);
  return {
    start: clarificationEntry(startPath, startDocument),
    descendants,
    documents: 1 + descendants.length,
    pending,
    status: pending === 0 ? 'closed' : 'open',
  };
}
