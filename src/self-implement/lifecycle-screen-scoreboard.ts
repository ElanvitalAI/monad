import type { PollExitReason } from './headless-monad-driver.js';
import type { LifecycleRecord } from '../signal/lifecycle-record.js';

export type LifecycleScreenComparison =
  | 'agree'
  | 'disagree'
  | 'screen-only'
  /** The old incomplete class: the screen reached completion but signal has no terminal declaration. */
  | 'signal-incomplete'
  /** The screen completed while a known-live child may still publish its terminal declaration. */
  | 'signal-not-yet'
  /** The screen reported non-completion before the child could publish a terminal declaration. */
  | 'signal-silent-after-screen-noncompletion'
  | 'signal-only';

interface ScreenVerdict {
  readonly exitReason: PollExitReason;
  readonly timedOut: boolean;
  readonly reachedCompletion: boolean;
}

export interface LifecycleScreenScope {
  readonly runId: string;
  readonly subjectPtyId: string | undefined;
  readonly availability?: 'available' | 'unavailable';
  /** Whether the observed child process has exited; undefined preserves legacy unknown semantics. */
  readonly childExited?: boolean;
}

interface ScopedLifecycleRecords {
  readonly records: readonly { readonly record: LifecycleRecord }[];
  readonly excluded: {
    readonly byRunId: number;
    readonly bySubjectPtyId: number;
  };
  readonly subjectPtyId: string | null;
  readonly unit: 'round';
  readonly status: 'scoped' | 'missing-subject' | 'unavailable';
}

interface LifecycleScreenScoreboard {
  readonly classification: LifecycleScreenComparison;
  readonly screen: ScreenVerdict;
  readonly signal: {
    readonly recordCount: number;
    readonly observedNames: readonly string[];
    readonly excluded: {
      readonly byRunId: number;
      readonly bySubjectPtyId: number;
    };
    readonly ended: boolean;
    readonly outcome: 'complete' | 'failed' | null;
    readonly subjectPtyId: string | null;
    readonly unit: 'round';
    readonly scopeStatus: 'scoped' | 'missing-subject' | 'no-records' | 'unavailable';
  };
}

/** Selects lifecycle declarations about the same child as the supplied screen verdict. */
export function scopeLifecycleToScreen(
  records: readonly { readonly record: LifecycleRecord }[],
  scope: LifecycleScreenScope,
): ScopedLifecycleRecords {
  const subjectPtyId = scope.subjectPtyId?.trim();
  if (!subjectPtyId) {
    return {
      records: [], excluded: { byRunId: 0, bySubjectPtyId: 0 }, subjectPtyId: null, unit: 'round', status: 'missing-subject',
    };
  }
  if (scope.availability === 'unavailable') {
    return {
      records: [], excluded: { byRunId: 0, bySubjectPtyId: 0 }, subjectPtyId, unit: 'round', status: 'unavailable',
    };
  }
  // ⛔ 귀속은 «배타적»이고 순서가 계약이다 — 둘 다 어긋난 레코드는 `byRunId` 에만 실린다.
  //    ⇒ `bySubjectPtyId` 는 «이 런 안에서 남의 자식»의 수이지 「subjectPtyId 불일치 전체」가 아니다.
  //    그래서 두 값의 합은 언제나 「버린 총수」와 같다(이중 계상이 없다).
  const excluded = { byRunId: 0, bySubjectPtyId: 0 };
  const scopedRecords = records.filter(({ record }) => {
    if (record.runId !== scope.runId) {
      excluded.byRunId += 1;
      return false;
    }
    if (record.subjectPtyId !== subjectPtyId) {
      excluded.bySubjectPtyId += 1;
      return false;
    }
    return true;
  });
  return {
    records: scopedRecords,
    excluded,
    subjectPtyId,
    unit: 'round',
    status: 'scoped',
  };
}

/** Compares the parent screen verdict with terminal lifecycle declarations for one child round. */
function didScreenConclude(exitReason: PollExitReason): boolean {
  switch (exitReason) {
    case 'child-exit':
    case 'completion-marker':
    case 'brain-stop':
      return true;
    case 'abort':
    case 'soft-timeout':
    case 'wallclock-cap':
    case 'loop-exhausted':
    case 'not-started':
      return false;
    default:
      return false;
  }
}

export function compareLifecycleToScreen(
  screen: ScreenVerdict,
  inputRecords: readonly { readonly record: LifecycleRecord }[],
  scope?: LifecycleScreenScope,
): LifecycleScreenScoreboard {
  const scoped = scope
    ? scopeLifecycleToScreen(inputRecords, scope)
    : {
      records: [], excluded: { byRunId: 0, bySubjectPtyId: 0 }, subjectPtyId: null, unit: 'round' as const,
      status: 'missing-subject' as const,
    };
  const records = scoped.records;
  const terminal = records.map(({ record }) => record).filter((record) =>
    record.class === 'progress' && (record.name === 'complete' || record.name === 'failed'));
  const last = terminal.at(-1);
  const outcome = last?.name === 'complete' ? 'complete' : last?.name === 'failed' ? 'failed' : null;
  const ended = outcome !== null;
  const screenConcluded = didScreenConclude(screen.exitReason);
  const classification: LifecycleScreenComparison = records.length === 0
    ? 'screen-only'
    : !ended
        ? screenConcluded && screen.reachedCompletion
          ? scope?.childExited === false ? 'signal-not-yet' : 'signal-incomplete'
          : 'signal-silent-after-screen-noncompletion'
        : !screenConcluded
          ? 'signal-only'
          : (outcome === 'complete') === screen.reachedCompletion
            ? 'agree'
            : 'disagree';

  return {
    classification,
    screen,
    signal: {
      recordCount: records.length,
      observedNames: records.slice(0, 20).map(({ record }) => record.name),
      excluded: scoped.excluded,
      ended,
      outcome,
      subjectPtyId: scoped.subjectPtyId,
      unit: scoped.unit,
      scopeStatus: scoped.status === 'scoped' && records.length === 0 ? 'no-records' : scoped.status,
    },
  };
}
