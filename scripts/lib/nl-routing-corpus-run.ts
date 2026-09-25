import { positiveInteger } from './nl-routing-measurement.js';
import { endsLiveRun, measureLiveTurn, waitForOpenTurnClose, type LiveRecord, type LiveTurnOptions, type LiveTurnRunner } from './nl-routing-live.js';

export interface CorpusRunItem {
  id: string;
  accept: readonly string[];
  reject?: readonly string[];
}

export interface CorpusRunOptions<Item extends CorpusRunItem> {
  /** Legacy call form: runLiveCorpus(runner, items, { sessions, ...options }). */
  sessions?: readonly string[];
  repeats: number;
  /** Explicitly permits reusing exactly one caller-provided session across repeats. */
  allowContaminatedSessionReuse?: boolean;
  settleMs: number;
  truncatedTurnWaitMs: number;
  pollMs: number;
  clock?: Pick<LiveTurnOptions, 'now' | 'sleep'>;
  promptForItem(item: Item): string;
  onMeasured(item: Item, rep: number, record: LiveRecord): void;
  onWaitingForOpenTurn(item: Item, rep: number, waitMs: number): void;
  onAbort(item: Item, rep: number, reason: string): void;
}

export interface CorpusRunResult {
  records: LiveRecord[];
  truncatedTurns: number;
  aborted: boolean;
  contaminatedSessionReuse: boolean;
}

export function resolveTruncatedTurnWaitMs(value: string | undefined, settleMs: number): number {
  return positiveInteger(value, 'CORPUS_TRUNCATED_TURN_WAIT_MS', settleMs * 3);
}

/** Runs the production corpus loop serially; no later input is delivered while a truncated turn remains open. */
export function runLiveCorpus<Item extends CorpusRunItem>(
  runner: LiveTurnRunner,
  sessions: readonly string[],
  items: readonly Item[],
  options: CorpusRunOptions<Item>,
): Promise<CorpusRunResult>;
/** Compatibility form retained for callers that supply the session rotation in options. */
export function runLiveCorpus<Item extends CorpusRunItem>(
  runner: LiveTurnRunner,
  items: readonly Item[],
  options: CorpusRunOptions<Item> & { sessions: readonly string[] },
): Promise<CorpusRunResult>;
export async function runLiveCorpus<Item extends CorpusRunItem>(
  runner: LiveTurnRunner,
  ...args: [sessions: readonly string[], items: readonly Item[], options: CorpusRunOptions<Item>] | [items: readonly Item[], options: CorpusRunOptions<Item> & { sessions: readonly string[] }]
): Promise<CorpusRunResult> {
  const invocation = args.length === 3
    ? { sessions: args[0], items: args[1], options: args[2] }
    : { sessions: args[1].sessions, items: args[0], options: args[1] };
  const { sessions, items, options } = invocation;
  const contaminatedSessionReuse = options.allowContaminatedSessionReuse === true && sessions.length === 1 && options.repeats > 1;
  if (sessions.length < options.repeats && !contaminatedSessionReuse) {
    throw new Error(`CORPUS_SESSIONS requires at least ${options.repeats} sessions for ${options.repeats} repeats.`);
  }
  const repeatSessions = contaminatedSessionReuse
    ? Array.from({ length: options.repeats }, () => sessions[0]!)
    : sessions.slice(0, options.repeats);
  if (!contaminatedSessionReuse && new Set(repeatSessions).size !== repeatSessions.length) {
    throw new Error('CORPUS_SESSIONS must provide a distinct session for every repeat.');
  }
  const records: LiveRecord[] = [];
  let truncatedTurns = 0;
  let aborted = false;
  for (const item of items) {
    for (let rep = 0; rep < options.repeats; rep += 1) {
      const sessionId = repeatSessions[rep]!;
      const result = await measureLiveTurn(runner, sessionId, item, options.promptForItem(item), rep, {
        settleMs: options.settleMs,
        pollMs: options.pollMs,
        ...options.clock,
      });
      if (result.kind === 'unmeasurable') {
        options.onAbort(item, rep, result.reason);
        aborted = true;
        break;
      }
      const { record } = result;
      records.push(record);
      if (record.truncated) truncatedTurns += 1;
      options.onMeasured(item, rep, record);
      if (endsLiveRun(result)) {
        if (result.openTurn) {
          options.onWaitingForOpenTurn(item, rep, options.truncatedTurnWaitMs);
          const settled = await waitForOpenTurnClose(runner, sessionId, result.openTurn, {
            settleMs: options.truncatedTurnWaitMs,
            pollMs: options.pollMs,
            ...options.clock,
          });
          if (settled === 'closed') continue;
          if (settled === 'snapshot-failed') {
            options.onAbort(item, rep, 'snapshot-failed');
            aborted = true;
            break;
          }
          // ⛔ 여기 오면 그 세션의 로그가 `truncatedTurnWaitMs` 동안 한 글자도 안 늘었다 —
          //    턴이 **진행 중이 아니라 멈춘 것**이다. 사유를 그렇게 적는다(경과 시간이 아니라).
          options.onAbort(item, rep, 'truncated-turn-stalled');
          aborted = true;
          break;
        }
        options.onAbort(item, rep, 'truncated-turn');
        aborted = true;
        break;
      }
    }
    if (aborted) break;
  }
  return { records, truncatedTurns, aborted, contaminatedSessionReuse };
}
