// ⛔⭐ `ShootCommand`·`ShootPlan` 을 «다시 선언하지 않는다» — `shoot-plan.ts` 것을 «그대로» 쓴다.
//   🩸 초판은 여기서 둘을 새로 선언했고, 그러면 ***같은 이름의 «다른 값»*** 둘이 생긴다.
//      이 저장소가 반복해 적은 병이다 — 통합이 반씩 골라 «합친 뒤에만» 빨강이 난다.
//   🔑 계획을 «만드는 쪽»이 그 모양의 주인이고, 실행부는 «읽기만» 한다.
export type { ShootCommand, ShootPlan } from './shoot-plan.js';
import type { ShootCommand, ShootPlan } from './shoot-plan.js';

/** External generation boundary; tests supply an in-memory backend. */
export interface ShootBackend {
  submit(command: ShootCommand): Promise<string>;
  poll(jobId: string): Promise<{ readonly status: string; readonly resultUrl?: string }>;
}

export interface ShootOutcome {
  readonly beatIndex: number;
  readonly jobId?: string;
  readonly resultUrl?: string;
  readonly failure?: string;
  /** Vendor terminal status that is neither known success, failure, nor ongoing. */
  readonly unknownStatus?: string;
  /** Polling ended before any known ongoing vendor status was observed. */
  readonly unobservedPolling?: true;
  /** Present only when polling stopped before the job settled. */
  readonly limitedBy?: 'attempts' | 'elapsed';
  /** Applied polling limits for an unsettled submitted job. */
  readonly pollingLimits?: {
    readonly maxPollsPerJob: number;
    readonly pollIntervalMs: number;
    readonly maxPollElapsedMs?: number;
  };
}

export interface ShootRunResult {
  readonly outcomes: readonly ShootOutcome[];
  readonly completed: number;
  readonly failed: number;
  readonly unknown: number;
  readonly timedOut: readonly number[];
  readonly blocked: number;
}

export interface ShootRunOptions {
  readonly pollIntervalMs?: number;
  readonly maxPollsPerJob?: number;
  /** Maximum wall-clock polling time per submitted job. Omit to use only the attempt limit. */
  readonly maxPollElapsedMs?: number;
  /** 제출 «사이» 간격(ms). ⛔ 0 은 «동시 제출»이고, 실측에서 그것은 «전부» 실패했다(아래).
   *  📏 `higgsfield-production/references/cli-playbook.md` 실측 2026-09-10:
   *     같은 순간 4건 제출 → ***4건 전부*** `request failed (no response received)`.
   *     20~30초 스태거로 통과. ⇒ 「던져 보고 되면 좋고」가 «아니다». */
  readonly submitStaggerMs?: number;
  /** 제출 실패 재시도 횟수. ✅ 실패는 크레딧을 «안 깎는다»(실측 2회) ⇒ 재시도가 싸다. */
  readonly submitRetries?: number;
}

const FAILED_STATUSES = new Set(['failed', 'error', 'nsfw']);
const ONGOING_STATUSES = new Set(['queued', 'in_progress']);
/** After the first unknown status, make at most two independent recovery observations. */
const MAX_UNKNOWN_STATUS_REOBSERVATIONS = 2;

/** 📏 플레이북 실측 = 20~30초. ⛔ 「검증된 최적」이 «아니다» — 표본이 한 창이다. */
const DEFAULT_SUBMIT_STAGGER_MS = 20_000;

function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wait(milliseconds: number): Promise<void> {
  return milliseconds > 0 ? new Promise((resolve) => setTimeout(resolve, milliseconds)) : Promise.resolve();
}

const MAX_TIMER_DELAY_MS = 2_147_483_647;

function pollBeforeDeadline(
  poll: () => Promise<{ readonly status: string; readonly resultUrl?: string }>,
  deadline: number | undefined,
): Promise<{ readonly status: string; readonly resultUrl?: string } | undefined> {
  if (deadline !== undefined && Date.now() >= deadline) return Promise.resolve(undefined);
  const pendingPoll = poll();
  if (deadline === undefined) return pendingPoll;
  if (Date.now() >= deadline) {
    void pendingPoll.then(() => undefined, () => undefined);
    return Promise.resolve(undefined);
  }
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (result: { readonly status: string; readonly resultUrl?: string } | undefined): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(result);
    };
    const waitForDeadline = (): void => {
      const millisecondsLeft = deadline - Date.now();
      if (millisecondsLeft <= 0) {
        finish(undefined);
        return;
      }
      timer = setTimeout(waitForDeadline, Math.min(millisecondsLeft, MAX_TIMER_DELAY_MS));
    };
    waitForDeadline();
    pendingPoll.then(
      (update) => finish(Date.now() >= deadline ? undefined : update),
      (error: unknown) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function validateMaxPollsPerJob(maxPollsPerJob: number): void {
  if (!Number.isInteger(maxPollsPerJob) || maxPollsPerJob <= 0) {
    throw new Error('maxPollsPerJob must be a finite positive integer.');
  }
}

function validateMaxPollElapsedMs(maxPollElapsedMs: number | undefined): void {
  if (maxPollElapsedMs !== undefined && (!Number.isFinite(maxPollElapsedMs) || maxPollElapsedMs < 0)) {
    throw new Error('maxPollElapsedMs must be a finite non-negative number.');
  }
}

function blockedBeatOutcomes(blocked: readonly string[]): ShootOutcome[] {
  return blocked.flatMap((reason) => {
    const match = /:beat-(\d+)$/.exec(reason);
    return match ? [{ beatIndex: Number(match[1]) - 1, failure: reason }] : [];
  });
}

export async function runShootPlan(
  plan: ShootPlan,
  backend: ShootBackend,
  options: ShootRunOptions = {},
): Promise<ShootRunResult> {
  const maxPollsPerJob = options.maxPollsPerJob ?? 20;
  const maxPollElapsedMs = options.maxPollElapsedMs;
  validateMaxPollsPerJob(maxPollsPerJob);
  validateMaxPollElapsedMs(maxPollElapsedMs);

  // `buildShootPlan` leaves commands only for beat-level blocks. An empty command
  // list is therefore the observable plan-level stop condition.
  if (plan.commands.length === 0) {
    const outcomes = blockedBeatOutcomes(plan.blocked);
    return { outcomes, completed: 0, failed: 0, unknown: 0, timedOut: [], blocked: outcomes.length };
  }

  const pollIntervalMs = options.pollIntervalMs ?? 0;
  const submitStaggerMs = options.submitStaggerMs ?? DEFAULT_SUBMIT_STAGGER_MS;
  const submitRetries = options.submitRetries ?? 1;
  const outcomes: ShootOutcome[] = blockedBeatOutcomes(plan.blocked);
  const timedOut: number[] = [];
  const blocked = outcomes.length;
  let completed = 0;
  let failed = 0;
  let unknown = 0;

  // ⛔⭐ **단계 «둘»로 가른다 — 다 제출한 «뒤»에 폴링한다.**
  //   🩸 초판은 한 컷을 «끝까지 기다린 뒤» 다음을 제출했다. 플레이북이 그것을 짚는다:
  //      *"--wait 는 블로킹이다. 샷 4개를 순차로 기다리면 20분이 그냥 간다."*
  //   ⊕ 그렇다고 «동시»에 던지면 전부 실패한다 ⇒ 답은 «스태거 제출 → 일괄 폴링»이다.
  const submitted: { readonly beatIndex: number; readonly jobId: string }[] = [];

  for (const [commandIndex, command] of plan.commands.entries()) {
    const { beatIndex } = command;
    if (commandIndex > 0) await wait(submitStaggerMs);
    let jobId: string | undefined;
    let lastError: unknown;
    // ✅ 실패는 크레딧을 «안 깎는다» ⇒ 한 번에 포기하지 않는다.
    for (let attempt = 0; attempt <= submitRetries; attempt += 1) {
      try { jobId = await backend.submit(command); break; }
      catch (error) { lastError = error; if (attempt < submitRetries) await wait(submitStaggerMs); }
    }
    if (jobId === undefined) {
      outcomes.push({ beatIndex, failure: failureReason(lastError) });
      failed += 1;
      continue;
    }
    submitted.push({ beatIndex, jobId });
  }

  for (const { beatIndex, jobId } of submitted) {
    let settled = false;
    let observedOngoing = false;
    let unknownStatus: string | undefined;
    let lastUnknownStatus: string | undefined;
    let unknownReobservations = 0;
    let limitedBy: 'attempts' | 'elapsed' = 'attempts';
    const pollingStartedAt = Date.now();
    const pollingDeadline = maxPollElapsedMs === undefined ? undefined : pollingStartedAt + maxPollElapsedMs;
    const settleUpdate = (update: { readonly status: string; readonly resultUrl?: string }): boolean => {
      if (update.status === 'completed') {
        outcomes.push({ beatIndex, jobId, ...(update.resultUrl ? { resultUrl: update.resultUrl } : {}) });
        completed += 1;
        settled = true;
        return true;
      }
      if (FAILED_STATUSES.has(update.status)) {
        outcomes.push({ beatIndex, jobId, failure: `Job ${jobId} reported ${update.status}.` });
        failed += 1;
        settled = true;
        return true;
      }
      if (ONGOING_STATUSES.has(update.status)) {
        observedOngoing = true;
        unknownStatus = undefined;
      } else {
        unknownStatus = update.status;
        lastUnknownStatus = update.status;
      }
      return false;
    };
    for (let pollCount = 0; !settled && (pollCount < maxPollsPerJob || (unknownStatus !== undefined && unknownReobservations < MAX_UNKNOWN_STATUS_REOBSERVATIONS));) {
      if (pollingDeadline !== undefined && Date.now() >= pollingDeadline) {
        limitedBy = 'elapsed';
        break;
      }
      if (unknownStatus !== undefined) {
        if (unknownReobservations >= MAX_UNKNOWN_STATUS_REOBSERVATIONS) break;
        unknownReobservations += 1;
        await wait(pollingDeadline === undefined
          ? pollIntervalMs
          : Math.min(pollIntervalMs, Math.max(0, pollingDeadline - Date.now())));
        if (pollingDeadline !== undefined && Date.now() >= pollingDeadline) {
          limitedBy = 'elapsed';
          break;
        }
        const pendingUnknownStatus = unknownStatus;
        unknownStatus = undefined;
        try {
          const update = await pollBeforeDeadline(() => backend.poll(jobId), pollingDeadline);
          if (update === undefined) {
            limitedBy = 'elapsed';
            unknownStatus = lastUnknownStatus ?? pendingUnknownStatus;
            break;
          }
          settleUpdate(update);
        } catch {
          unknownStatus = lastUnknownStatus ?? pendingUnknownStatus;
        }
        continue;
      }
      try {
        const update = await pollBeforeDeadline(() => backend.poll(jobId), pollingDeadline);
        if (update === undefined) {
          limitedBy = 'elapsed';
          break;
        }
        pollCount += 1;
        settleUpdate(update);
      } catch {
        pollCount += 1;
      }
      if (pollingDeadline !== undefined && Date.now() >= pollingDeadline) {
        limitedBy = 'elapsed';
        break;
      }
      if (!settled && unknownStatus === undefined && pollCount < maxPollsPerJob) {
        const remainingPollTime = pollingDeadline === undefined
          ? pollIntervalMs
          : Math.min(pollIntervalMs, Math.max(0, pollingDeadline - Date.now()));
        await wait(remainingPollTime);
      }
    }
    if (!settled && unknownStatus !== undefined) {
      outcomes.push({ beatIndex, jobId, unknownStatus });
      unknown += 1;
      settled = true;
    }
    if (!settled) {
      const pollingLimits = { maxPollsPerJob, pollIntervalMs, ...(maxPollElapsedMs === undefined ? {} : { maxPollElapsedMs }) };
      outcomes.push({
        beatIndex,
        jobId,
        ...(observedOngoing ? {} : { unobservedPolling: true }),
        limitedBy,
        pollingLimits,
      });
      if (observedOngoing) timedOut.push(beatIndex);
      else unknown += 1;
    }
  }

  outcomes.sort((a, b) => a.beatIndex - b.beatIndex);

  return { outcomes, completed, failed, unknown, timedOut, blocked };
}
