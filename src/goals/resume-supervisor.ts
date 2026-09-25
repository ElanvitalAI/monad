import { listRunLedgers, lookupRunLedger, type RunLedgerEntry, type RunLedgerLookup, type RunLedgerLookupOptions } from '../self-implement/run-ledger.js';
import { isGoalStatus, type GoalStatus } from './types.js';

export interface GoalStatusOrigin {
  targetName: string | null;
  ledgerDirectory: string;
  ledgerPath: string;
}

export interface GoalStatusObservation {
  found: true;
  goalId: string;
  status: GoalStatus;
  transitionedAt: string;
  reason: string;
  runId: string;
  origin: GoalStatusOrigin;
}

export interface GoalStatusUnknown {
  found: false;
  goalId: string;
  kind: 'not-found';
}

export interface GoalStatusAmbiguous {
  found: false;
  goalId: string;
  kind: 'ambiguous';
  transitionedAt: string;
  candidates: readonly GoalStatusObservation[];
}

export type GoalStatusQuery = GoalStatusObservation | GoalStatusUnknown | GoalStatusAmbiguous;

export interface GoalStatusQueryOptions extends RunLedgerLookupOptions {
  lookup?: (runId: string, options: RunLedgerLookupOptions) => RunLedgerLookup;
  listLedgers?: (options: RunLedgerLookupOptions) => RunLedgerLookup;
}

function isGoalStatusEntry(entry: RunLedgerEntry, goalId?: string): entry is RunLedgerEntry & { goalId: string; timestamp: string; data: { producer: 'goal-loop'; runIdSource: 'goal-self'; from: GoalStatus; to: GoalStatus; reason: string } } {
  return (goalId === undefined || entry.goalId === goalId)
    && typeof entry.goalId === 'string'
    && entry.event === 'goal-status'
    && typeof entry.timestamp === 'string'
    && Number.isFinite(Date.parse(entry.timestamp))
    && entry.data.producer === 'goal-loop'
    && entry.data.runIdSource === 'goal-self'
    && isGoalStatus(entry.data.from)
    && isGoalStatus(entry.data.to)
    && typeof entry.data.reason === 'string';
}

function transitionIdentity(candidate: GoalStatusObservation, from: GoalStatus): string {
  return JSON.stringify({
    goalId: candidate.goalId,
    runId: candidate.runId,
    transitionedAt: candidate.transitionedAt,
    from,
    status: candidate.status,
    reason: candidate.reason,
  });
}

function deduplicateMatches(matches: readonly RunLedgerLookup['matches'][number][]): RunLedgerLookup['matches'] {
  return matches.filter((match, index, all) => all.findIndex((candidate) => candidate.ledgerPath === match.ledgerPath) === index);
}

function queryGoalStatusFromMatches(goalId: string, matches: readonly RunLedgerLookup['matches'][number][]): GoalStatusQuery {
  const candidates = new Map<string, GoalStatusObservation>();
  for (const match of matches) {
    for (const entry of match.entries) {
      if (!isGoalStatusEntry(entry, goalId)) continue;
      const candidate: GoalStatusObservation = {
        found: true,
        goalId,
        status: entry.data.to,
        transitionedAt: entry.timestamp,
        reason: entry.data.reason,
        runId: entry.runId,
        origin: {
          targetName: match.targetName,
          ledgerDirectory: match.ledgerDirectory,
          ledgerPath: match.ledgerPath,
        },
      };
      const identity = transitionIdentity(candidate, entry.data.from);
      const existing = candidates.get(identity);
      if (!existing || candidate.origin.ledgerPath < existing.origin.ledgerPath) candidates.set(identity, candidate);
    }
  }
  const values = [...candidates.values()];
  if (values.length === 0) return { found: false, goalId, kind: 'not-found' };
  const latestTimestamp = Math.max(...values.map((candidate) => Date.parse(candidate.transitionedAt)));
  const latest = values.filter((candidate) => Date.parse(candidate.transitionedAt) === latestTimestamp)
    .sort((left, right) => left.origin.ledgerPath.localeCompare(right.origin.ledgerPath));
  if (latest.length > 1) {
    return {
      found: false,
      goalId,
      kind: 'ambiguous',
      transitionedAt: new Date(latestTimestamp).toISOString(),
      candidates: latest,
    };
  }
  return latest[0]!;
}

/** Read the latest durable goal-status transition without consulting the in-memory goal registry. */
export function queryGoalStatus(goalId: string, options: GoalStatusQueryOptions = {}): GoalStatusQuery {
  const { lookup = lookupRunLedger, listLedgers, ...lookupOptions } = options;
  const lookupMatches = [
    ...lookup(goalId, { ...lookupOptions, all: false }).matches,
    ...lookup(goalId, { ...lookupOptions, all: true }).matches,
  ];
  const shouldEnumerate = lookup === lookupRunLedger || listLedgers !== undefined;
  const enumeratedMatches = shouldEnumerate
    ? [
      ...(listLedgers ?? listRunLedgers)({ ...lookupOptions, all: false }).matches.filter((match) => match.entries.some((entry) => entry.goalId === goalId)),
      ...(listLedgers ?? listRunLedgers)({ ...lookupOptions, all: true }).matches.filter((match) => match.entries.some((entry) => entry.goalId === goalId)),
    ]
    : [];
  return queryGoalStatusFromMatches(goalId, deduplicateMatches([...lookupMatches, ...enumeratedMatches]));
}

/** Discover goals whose unambiguous latest durable transition is paused without consulting the in-memory goal registry. */
export function queryPausedGoalStatuses(options: GoalStatusQueryOptions = {}): readonly GoalStatusObservation[] {
  const { listLedgers = listRunLedgers, ...lookupOptions } = options;
  const matches = deduplicateMatches([
    ...listLedgers({ ...lookupOptions, all: false }).matches,
    ...listLedgers({ ...lookupOptions, all: true }).matches,
  ]);
  const goalIds = new Set<string>();
  for (const match of matches) {
    for (const entry of match.entries) {
      if (isGoalStatusEntry(entry)) goalIds.add(entry.goalId);
    }
  }
  return [...goalIds]
    .map((goalId) => queryGoalStatusFromMatches(goalId, matches))
    .filter((query): query is GoalStatusObservation => query.found && query.status === 'paused')
    .sort((left, right) => left.goalId.localeCompare(right.goalId));
}

export function renderGoalStatus(query: GoalStatusQuery): string {
  if (query.found) return `goalId=${query.goalId} status=${query.status} transitionedAt=${query.transitionedAt} reason=${JSON.stringify(query.reason)} runId=${query.runId} ledgerPath=${query.origin.ledgerPath}`;
  if (query.kind === 'ambiguous') return `goal status ambiguous: ${query.goalId} transitionedAt=${query.transitionedAt} candidates=${query.candidates.map((candidate) => `${candidate.runId}@${candidate.origin.ledgerPath}`).join(',')}`;
  return `goal status not found: ${query.goalId}`;
}
