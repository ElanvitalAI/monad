export const CLARIFY_PENDING_TRIAGE_CUTOFF = '2026-08-11';

export type ClarifyPendingRunStatusKind = 'finished' | 'unfinished' | 'no-record' | 'unavailable';

export interface ClarifyPendingTriageInput {
  readonly status: { readonly kind: ClarifyPendingRunStatusKind };
  readonly createdAt?: Date;
}

export interface ClarifyPendingTriage<T extends ClarifyPendingTriageInput> {
  readonly nowAnswerable: readonly T[];
  readonly past: readonly T[];
}

export interface ClarifyPendingPopulationScope {
  readonly goalRunStore: {
    readonly path: string;
    readonly recordCount: number | null;
    readonly readFailed: boolean;
    readonly missing: boolean;
  };
  readonly unfinishedRunLedger: {
    readonly directory: string | null;
    readonly entryCount: number | null;
    readonly unreadableLedgerCount: number | null;
    readonly directoryMissing: boolean | null;
    readonly readFailed: boolean;
  };
}

/** Render the exact current-instance populations used to classify no-record rows. */
export function formatClarifyPendingPopulationScope(scope: ClarifyPendingPopulationScope): string {
  const store = scope.goalRunStore;
  const ledger = scope.unfinishedRunLedger;
  const storeState = store.readFailed ? 'read-failed' : store.missing ? 'missing' : 'readable';
  const ledgerState = ledger.readFailed
    ? 'read-failed'
    : ledger.directoryMissing
      ? 'missing'
      : ledger.unreadableLedgerCount && ledger.unreadableLedgerCount > 0
        ? `${ledger.unreadableLedgerCount} ledger unreadable`
        : 'readable';
  return `scope: population goal-run-store path=${store.path} records=${store.recordCount ?? 'unavailable'} state=${storeState}; unfinished-run-ledger directory=${ledger.directory ?? 'unavailable'} entries=${ledger.entryCount ?? 'unavailable'} state=${ledgerState}`;
}

/** Read the authored-goal submission date; invalid or absent metadata remains unknown. */
export function parseClarifyPendingCreatedAt(document: string): Date | undefined {
  const match = document.match(/^submitted:\s*(\d{4})-(\d{2})-(\d{2})(?:\s|$)/mi);
  if (!match) return undefined;
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00.000+09:00`);
  if (!Number.isFinite(date.getTime())) return undefined;
  const parsed = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const fields = Object.fromEntries(parsed.map((field) => [field.type, field.value]));
  return fields.year === year && fields.month === month && fields.day === day ? date : undefined;
}

function kstCalendarDate(date: Date): string | null {
  if (!Number.isFinite(date.getTime())) return null;
  const fields = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(fields.map((field) => [field.type, field.value]));
  return values.year && values.month && values.day ? `${values.year}-${values.month}-${values.day}` : null;
}

/** Partition pending clarifications without dropping or changing their input rows. */
export function triageClarifyPending<T extends ClarifyPendingTriageInput>(
  rows: readonly T[],
  cutoff: string = CLARIFY_PENDING_TRIAGE_CUTOFF,
): ClarifyPendingTriage<T> {
  const nowAnswerable: T[] = [];
  const past: T[] = [];
  for (const row of rows) {
    const createdDate = row.createdAt ? kstCalendarDate(row.createdAt) : null;
    if (row.status.kind === 'finished' || (row.status.kind === 'no-record' && createdDate !== null && createdDate < cutoff)) {
      past.push(row);
    } else {
      nowAnswerable.push(row);
    }
  }
  return { nowAnswerable, past };
}
