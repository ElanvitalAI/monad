import { statSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';
import {
  decomposeFabricRequest,
  type FabricDecomposeGoal,
  type FabricDecomposeGround,
  type FabricDecomposeRequestResult,
  type FabricDecomposeResolve,
} from '../../src/self-dev/fabric-decompose-adapter.js';

/**
 * `decomposeFabricRequest` produces these statuses when invoked with the
 * required non-empty grounding mock. `missing-research-context` belongs to
 * the lower-level fabric API and cannot be produced after request grounding.
 */
type FabricArcObserveStatus = Exclude<FabricDecomposeRequestResult['status'], 'missing-research-context'>;

interface FabricArcSpecificityEvidence {
  repositoryPaths: string[];
  backtickedIdentifiers: string[];
  executableCommands: string[];
}

interface FabricArcGroundingCitation {
  citation: string;
  documentPath: string;
  evidenceLine: string;
}

interface FabricArcGroundingCitationEvidence {
  citations: FabricArcGroundingCitation[];
  score: number;
  candidateCount: number;
}

interface FabricArcGoalSpecificity extends FabricArcSpecificityEvidence {
  feature: string;
  score: number;
}

interface FabricArcObservation {
  status: FabricArcObserveStatus;
  goalCount: number;
  /** Goals omitted because their targets could not be named; null before decomposition completes. */
  omittedGoalCount: number | null;
  /** Arcs skipped by the cumulative goal budget; null before decomposition completes. */
  budgetSkippedArcCount: number | null;
  /** Whether the cumulative goal budget limited emitted arcs; null before decomposition completes. */
  budgetLimited: boolean | null;
  /** Raw `goals[].dependsOn` entries, matching `normalizeDecomposition` in decompose-ab. */
  dependencyEdges: number;
  /** Dependency references that do not name an emitted goal. */
  invalidDependencyEdges: number;
  /** Repeated dependency references within one emitted goal. */
  duplicateDependencyEdges: number;
  specificity: {
    goals: FabricArcGoalSpecificity[];
    score: number;
    evidence: FabricArcSpecificityEvidence;
  };
  groundingCitations: FabricArcGroundingCitationEvidence;
}

/** All three seams are required so this observation never reaches the default LLM path. */
export interface FabricArcObserveOptions {
  request: string;
  ground: FabricDecomposeGround;
  resolve: FabricDecomposeResolve;
  decomposeGoal: FabricDecomposeGoal;
}

const REPOSITORY_PATH = /\b(?:src|scripts|test|tests|docs|apps|packages|bin)\/[\w./-]+\.[a-z0-9]{1,5}\b/gi;
const BACKTICKED_IDENTIFIER = /`([A-Za-z_$][\w.$:-]*)`/g;
const GROUNDED_DOCUMENT_PATH = /\b(?:src|scripts|test|tests|docs|apps|packages|bin)\/[\w./-]+\.[a-z0-9]{1,5}\b/gi;
const EXECUTABLE_COMMAND = /(?:^|\n)\s*(?:(?:bun|npm|pnpm|yarn|node|deno|python3?|tsc|git|monad)\b[^\n]*)/gim;
const REPOSITORY_ROOT = resolve(import.meta.dir, '../..');
const REPOSITORY_ROOT_PREFIX = `${REPOSITORY_ROOT}${sep}`;

function isExistingRepositoryFile(candidate: string): boolean {
  const absolute = resolve(REPOSITORY_ROOT, candidate);
  if (!absolute.startsWith(REPOSITORY_ROOT_PREFIX)) return false;
  try {
    return statSync(absolute).isFile();
  } catch {
    return false;
  }
}

function uniqueMatches(feature: string, expression: RegExp, group = 0): string[] {
  const matches = new Set<string>();
  for (const match of feature.matchAll(expression)) {
    const value = match[group]?.trim();
    if (value) matches.add(value);
  }
  return [...matches];
}

/**
 * Scores explicit verification candidates in one goal feature. The score is
 * the count of unique path, identifier, and command candidates; it does not
 * claim that an injected mock matches a live-model decomposition.
 */
function observeFabricArcGoalSpecificity(feature: string): FabricArcGoalSpecificity {
  const repositoryPaths = uniqueMatches(feature, REPOSITORY_PATH).filter(isExistingRepositoryFile);
  const backtickedIdentifiers = uniqueMatches(feature, BACKTICKED_IDENTIFIER, 1);
  const executableCommands = uniqueMatches(feature, EXECUTABLE_COMMAND);
  return {
    feature,
    repositoryPaths,
    backtickedIdentifiers,
    executableCommands,
    score: repositoryPaths.length + backtickedIdentifiers.length + executableCommands.length,
  };
}

function extractGroundedDocuments(documentLines: readonly string[]): FabricArcGroundingCitation[] {
  return documentLines.flatMap((evidenceLine) => uniqueMatches(evidenceLine, GROUNDED_DOCUMENT_PATH).map((documentPath) => ({
    citation: basename(documentPath),
    documentPath,
    evidenceLine,
  })));
}

function observeGroundingCitations(
  features: readonly string[],
  documentLines: readonly string[],
): FabricArcGroundingCitationEvidence {
  const citedBasenames = new Set(features.flatMap((feature) => uniqueMatches(feature, BACKTICKED_IDENTIFIER, 1)));
  const candidates = extractGroundedDocuments(documentLines);
  const citations = candidates.filter(({ citation }) => citedBasenames.has(citation));
  return { citations, score: citations.length, candidateCount: candidates.length };
}

function emptySpecificity(): FabricArcObservation['specificity'] {
  return {
    goals: [],
    score: 0,
    evidence: { repositoryPaths: [], backtickedIdentifiers: [], executableCommands: [] },
  };
}

function emptyGroundingCitations(): FabricArcGroundingCitationEvidence {
  return { citations: [], score: 0, candidateCount: 0 };
}

/**
 * Observes one fully injected fabric decomposition request. This module is an
 * intentionally un-wired library boundary: corpus runners and CLI exposure
 * are outside this landing's scope.
 */
export async function observeFabricArc(options: FabricArcObserveOptions): Promise<FabricArcObservation> {
  let documentLines: readonly string[] = [];
  const result = await decomposeFabricRequest(options.request, {
    ground: async (request, deps) => {
      const grounding = await options.ground(request, deps);
      documentLines = grounding.documentLines;
      return grounding;
    },
    resolve: options.resolve,
    decomposeGoal: options.decomposeGoal,
  });

  if (result.status === 'missing-research-context') {
    throw new Error('decomposeFabricRequest cannot return missing-research-context after non-empty grounding');
  }

  if (result.status !== 'decomposed') {
    return {
      status: result.status,
      goalCount: 0,
      omittedGoalCount: null,
      budgetSkippedArcCount: null,
      budgetLimited: null,
      dependencyEdges: 0,
      invalidDependencyEdges: 0,
      duplicateDependencyEdges: 0,
      specificity: emptySpecificity(),
      groundingCitations: emptyGroundingCitations(),
    };
  }

  const ids = new Set(result.goals.map((goal) => goal.id));
  const dependencies = result.goals.flatMap((goal) => goal.dependsOn ?? []);
  const duplicateDependencyEdges = result.goals.reduce((count, goal) => {
    const dependsOn = goal.dependsOn ?? [];
    return count + dependsOn.length - new Set(dependsOn).size;
  }, 0);
  const features = result.goals.map((goal) => goal.feature ?? '');
  const goals = features.map(observeFabricArcGoalSpecificity);
  const groundingCitations = observeGroundingCitations(features, documentLines);
  const evidence = {
    repositoryPaths: [...new Set(goals.flatMap((goal) => goal.repositoryPaths))],
    backtickedIdentifiers: [...new Set(goals.flatMap((goal) => goal.backtickedIdentifiers))],
    executableCommands: [...new Set(goals.flatMap((goal) => goal.executableCommands))],
  };

  return {
    status: result.status,
    goalCount: result.goals.length,
    omittedGoalCount: result.omittedGoalCount,
    budgetSkippedArcCount: result.budgetSkippedArcCount,
    budgetLimited: result.budgetLimited,
    dependencyEdges: dependencies.length,
    invalidDependencyEdges: dependencies.filter((dependency) => !ids.has(dependency)).length,
    duplicateDependencyEdges,
    specificity: {
      goals,
      score: evidence.repositoryPaths.length + evidence.backtickedIdentifiers.length + evidence.executableCommands.length,
      evidence,
    },
    groundingCitations,
  };
}
