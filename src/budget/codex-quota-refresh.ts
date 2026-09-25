import { debug, redactSecretText } from '../debug/log.js';
import { listCodexAccountsInStore, type StoredCodexAccount } from '../oauth/codex-account-store.js';
import { authStorePath, defaultCodexHome, loadTokens } from '../oauth/store.js';
import { effectiveCodexHome } from '../oauth/codex-account.js';
import { readQuotaSignalObservedAt } from './codex-reset-credit-state.js';
import { createCodexFetcher } from './fetchers/codex.js';

const DEFAULT_CODEX_QUOTA_FRESHNESS_MS = 30 * 60 * 1000;
const DEFAULT_CODEX_QUOTA_ACCOUNT_TIMEOUT_MS = 20 * 1000;
const DEFAULT_CODEX_QUOTA_REFRESH_TIMEOUT_MS = 40 * 1000;

// ⛔⭐ 아래 타입 다섯은 «비공개»다 — 밖에서 이름으로 부를 소비처가 «없다»(리뷰 must-fix · dead export 금지).
//   ⭐ 이 모듈이 밖에 내는 것은 `refreshCodexQuotaSignals` «하나»뿐이고, 호출자는 옵션을 객체
//   리터럴로 주고 결과를 구조적으로 읽는다 — `codex-account-rotation.ts` 가 쓰는 관용구와 같다.
//   ⛔ 소비처가 생기면 그때 «그 소비처와 함께» 공개한다. 먼저 공개해 두지 않는다.
// ⛔⭐⭐ 이름이 «뜻»을 말해야 한다(리뷰 must-fix: 타임아웃 분류 계약).
//   종전엔 «시도조차 안 한» 계정에 `timed-out` 을 붙이고, 정작 «측정이 상한을 넘긴» 계정엔
//   `failed` 를 붙였다 — 읽는 사람이 정확히 «반대로» 읽는다.
//   ⇒ 셋을 가른다. 그래야 조회에서 「무엇을 고쳐야 하나」가 갈린다:
//     skipped-by-cap = 전체 상한에 걸려 «시도 안 함»   ⇒ 상한을 늘릴 문제
//     timed-out      = 이 계정 측정이 «상한을 넘김»     ⇒ 그 계정/네트워크 문제
//     failed         = 측정이 «던짐»                    ⇒ 인증·경로 문제
type CodexQuotaRefreshStatus = 'fresh' | 'refreshed' | 'failed' | 'missing-home' | 'timed-out' | 'skipped-by-cap';

interface CodexQuotaRefreshItem {
  readonly account: string;
  readonly status: CodexQuotaRefreshStatus;
}

interface CodexQuotaRefreshResult {
  readonly accounts: readonly CodexQuotaRefreshItem[];
}

interface CodexQuotaRefreshDeps {
  readonly now?: () => number;
  readonly listAccounts?: () => readonly StoredCodexAccount[];
  readonly loadAccount?: (storeKey: string) => { codexHome?: string } | undefined;
  readonly readObservedAt?: (nowMs: number, home: string) => number | undefined;
  readonly fetch?: (home: string, signal: AbortSignal) => Promise<unknown>;
  readonly observe?: (event: string, data: Record<string, unknown>) => void;
}

interface RefreshCodexQuotaSignalsOpts {
  readonly freshnessMs?: number;
  readonly accountTimeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly deps?: CodexQuotaRefreshDeps;
}

function defaultFetch(home: string, signal: AbortSignal): Promise<unknown> {
  return createCodexFetcher({ codexHome: home, signal }).fetch();
}

function withinFreshness(observedAt: number | undefined, nowMs: number, freshnessMs: number): boolean {
  return observedAt !== undefined && nowMs - observedAt >= 0 && nowMs - observedAt <= freshnessMs;
}

function counts(items: readonly CodexQuotaRefreshItem[]): Record<CodexQuotaRefreshStatus, number> {
  return {
    fresh: items.filter((item) => item.status === 'fresh').length,
    refreshed: items.filter((item) => item.status === 'refreshed').length,
    failed: items.filter((item) => item.status === 'failed').length,
    'missing-home': items.filter((item) => item.status === 'missing-home').length,
    'timed-out': items.filter((item) => item.status === 'timed-out').length,
    'skipped-by-cap': items.filter((item) => item.status === 'skipped-by-cap').length,
  };
}

function waitForFetchOrTimeout(fetch: (signal: AbortSignal) => Promise<unknown>, timeoutMs: number): Promise<'done' | 'timeout'> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fetchPromise: Promise<unknown>;
  try {
    fetchPromise = Promise.resolve(fetch(controller.signal));
  } catch (error) {
    return Promise.reject(error);
  }
  fetchPromise.catch(() => {});
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve('timeout');
    }, timeoutMs);
    fetchPromise.then(
      () => {
        clearTimeout(timer);
        resolve('done');
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Refreshes only stale, account-home-keyed Codex quota signals. It deliberately never
 * changes process.env: createCodexFetcher passes each home only to its child process.
 */
export async function refreshCodexQuotaSignals(
  opts: RefreshCodexQuotaSignalsOpts = {},
): Promise<CodexQuotaRefreshResult> {
  const freshnessMs = opts.freshnessMs ?? DEFAULT_CODEX_QUOTA_FRESHNESS_MS;
  const accountTimeoutMs = opts.accountTimeoutMs ?? DEFAULT_CODEX_QUOTA_ACCOUNT_TIMEOUT_MS;
  const totalTimeoutMs = opts.totalTimeoutMs ?? DEFAULT_CODEX_QUOTA_REFRESH_TIMEOUT_MS;
  const deps = opts.deps ?? {};
  const now = deps.now ?? Date.now;
  const listAccounts = deps.listAccounts ?? (() => listCodexAccountsInStore());
  const loadAccount = deps.loadAccount ?? ((storeKey) => loadTokens(storeKey, authStorePath()));
  const readObservedAt = deps.readObservedAt ?? readQuotaSignalObservedAt;
  const fetch = deps.fetch ?? defaultFetch;
  const observe = deps.observe ?? ((event, data) => debug.log('budget.codex-quota-refresh', event, data));
  const startedAt = now();
  const deadline = startedAt + totalTimeoutMs;
  const items: CodexQuotaRefreshItem[] = [];
  let accounts: readonly StoredCodexAccount[];

  try {
    accounts = listAccounts();
  } catch (error) {
    // ⛔⭐⭐ 삼키지 «않는다»(리뷰 should-fix). 종전엔 빈 «성공»을 돌려줘서, 호출자(orchestrator)가
    //   `quota-refresh: completed` 로 기록했다 — ***관측이 상위 상태와 정면으로 모순됐다.***
    //   ⭐ 던져도 런은 «안» 막힌다 — 호출자가 이미 try/catch 로 감싸 `failed` 로 기록하고 계속한다.
    //   ⇒ fail-soft 는 그대로이고, 「무슨 일이 있었나」만 정직해진다.
    // ⛔⭐ 이름이 «어느 층이 죽었나»를 말해야 한다 — 이것은 «갱신 전체»가 죽은 것이고
    //   (바로 아래에서 throw 한다), 계정 하나가 삐끗한 `account-failed` 와 «다른 사건»이다.
    //   한 이름으로 두면 조회에서 「전부 죽었다」와 「하나가 실패했다」가 한 수에 뭉개진다.
    // ⛔ 거르개도 계정 경로와 «같은 것»을 쓴다 — 한 파일에서 갈리면 한쪽만 새는 자리가 생긴다.
    observe('refresh-failed', {
      reason: redactSecretText(error instanceof Error ? error.message : String(error)).slice(0, 160),
    });
    throw error;
  }

  for (let index = 0; index < accounts.length; index++) {
    const account = accounts[index]!;
    if (now() >= deadline) {
      for (const remaining of accounts.slice(index)) items.push({ account: remaining.name, status: 'skipped-by-cap' });
      break;
    }
    try {
      // ⛔⭐⭐⭐ 「홈을 모른다」의 자를 «런타임과 같은 것»으로 쓴다(2026-08-07).
      //   종전엔 `codexHome` «만» 봐서 ***기본 계정이 영영 `missing-home` 이었다*** — 그 계정의 홈은
      //   모르는 게 아니라 규칙(`CODEX_HOME || ~/.codex`)으로 정해져 있는데도. 그래서 그 계정만
      //   쿼터를 «한 번도» 안 쟀고, 안 재니 신호가 없고, 신호가 없으니 회전 판정도 그 계정을 못 봤다.
      //   ✅ `effectiveCodexHome` 이 그 규칙의 정본이다 — 이름 계정이 홈을 모르면 여전히 undefined 다.
      const stored = loadAccount(account.storeKey) ?? null;
      const home = effectiveCodexHome(
        { name: account.name, storeKey: account.storeKey, home: defaultCodexHome(), source: 'default' },
        stored,
        process.env,
      ).home?.trim();
      if (!home) {
        items.push({ account: account.name, status: 'missing-home' });
        continue;
      }
      if (withinFreshness(readObservedAt(now(), home), now(), freshnessMs)) {
        items.push({ account: account.name, status: 'fresh' });
        continue;
      }

      // ⛔⭐⭐ 상한을 «fetch 직전»에 다시 본다(리뷰 must-fix). 위 관문 뒤로 계정 로드와 신호 조회가
      //   시간을 쓰므로, 그 사이에 상한이 지날 수 있다. 그때 그냥 내려가면 `waitForFetchOrTimeout` 이
      //   ***타이머보다 «먼저» fetch 를 부른다*** — 즉 상한을 넘겨서 «자식 프로세스를 실제로 띄운다».
      //   ⇒ 전체 상한 보장이 깨지고, 분류도 `skipped-by-cap` 이 아니라 `timed-out` 으로 거짓말한다.
      const remainingMs = deadline - now();
      if (remainingMs <= 0) {
        for (const remaining of accounts.slice(index)) items.push({ account: remaining.name, status: 'skipped-by-cap' });
        break;
      }
      const timeoutMs = Math.min(accountTimeoutMs, remainingMs);
      const outcome = await waitForFetchOrTimeout((signal) => fetch(home, signal), timeoutMs);
      if (outcome === 'timeout') {
        items.push({ account: account.name, status: 'timed-out' });
      } else {
        items.push({ account: account.name, status: 'refreshed' });
      }
    } catch (error) {
      // ⛔ 계정별 실패는 수를 completed 배열에 싣지 않는다 — debug.log 배열은 상한에서
      //   잘리므로 계정이 늘면 조용히 사라진다. 이름·사유는 사건 한 줄로 남긴다.
      // ⛔ 실패 관측이 던져도 계정 루프는 계속 돈다 — observe 예외를 국소 격리한다.
      try {
        observe('account-failed', {
          account: account.name,
          reason: redactSecretText(error instanceof Error ? error.message : String(error)).slice(0, 160),
        });
      } catch {
        // fail-soft: 관측 콜백 실패는 status:'failed' 기록과 다음 계정을 막지 않는다.
      }
      items.push({ account: account.name, status: 'failed' });
    }
  }

  const summary = counts(items);
  // ⭐ `skipped` 는 «재지 않은» 것만 센다 — `timed-out` 은 «재다가» 상한을 넘긴 것이므로 여기 안 넣는다.
  //   (종전엔 넣어서, 「안 쟀다」와 「재려다 못 잤다」가 한 수에 뭉개졌다.)
  observe('completed', {
    total: items.length, ...summary,
    skipped: summary.fresh + summary['missing-home'] + summary['skipped-by-cap'],
  });
  return { accounts: items };
}
