import { describe, expect, test } from 'bun:test';
import { refreshCodexQuotaSignals } from './codex-quota-refresh.js';

type Observed = { event: string; data: Record<string, unknown> };

function accountFailedEvents(observed: readonly Observed[]): Observed[] {
  return observed.filter((item) => (
    item.event === 'account-failed'
    && typeof item.data.account === 'string'
    && typeof item.data.reason === 'string'
  ));
}

function completedEvents(observed: readonly Observed[]): Observed[] {
  return observed.filter((item) => item.event === 'completed');
}

describe('refreshCodexQuotaSignals — per-account failure observation', () => {
  test('a throwing fetch emits exactly one account+reason event and continues', async () => {
    const observed: Observed[] = [];
    const fetched: string[] = [];
    const result = await refreshCodexQuotaSignals({
      deps: {
        now: () => 1_000_000,
        listAccounts: () => [
          { name: 'broken', storeKey: 'openai-codex:broken' },
          { name: 'later', storeKey: 'openai-codex:later' },
        ],
        loadAccount: (key) => ({ codexHome: `/homes/${key}` }),
        readObservedAt: () => undefined,
        fetch: async (home) => {
          fetched.push(home);
          if (home.endsWith('broken')) throw new Error('measurement failed');
        },
        observe: (event, data) => { observed.push({ event, data }); },
      },
    });

    expect(result.accounts).toEqual([
      { account: 'broken', status: 'failed' },
      { account: 'later', status: 'refreshed' },
    ]);
    expect(fetched).toEqual(['/homes/openai-codex:broken', '/homes/openai-codex:later']);
    expect(accountFailedEvents(observed)).toEqual([
      { event: 'account-failed', data: { account: 'broken', reason: 'measurement failed' } },
    ]);
  });

  test('timed-out classification does not emit the per-account failure observation', async () => {
    const observed: Observed[] = [];
    const result = await refreshCodexQuotaSignals({
      accountTimeoutMs: 5,
      deps: {
        now: () => 1_000_000,
        listAccounts: () => [
          { name: 'slow', storeKey: 'openai-codex:slow' },
          { name: 'later', storeKey: 'openai-codex:later' },
        ],
        loadAccount: (key) => ({ codexHome: `/homes/${key}` }),
        readObservedAt: () => undefined,
        fetch: async (home) => {
          if (home.endsWith('slow')) await new Promise<void>(() => {});
        },
        observe: (event, data) => { observed.push({ event, data }); },
      },
    });

    expect(result.accounts).toEqual([
      { account: 'slow', status: 'timed-out' },
      { account: 'later', status: 'refreshed' },
    ]);
    expect(accountFailedEvents(observed)).toEqual([]);
  });

  test('missing-home classification does not emit the per-account failure observation', async () => {
    const observed: Observed[] = [];
    const result = await refreshCodexQuotaSignals({
      deps: {
        now: () => 1_000_000,
        listAccounts: () => [
          { name: 'unknown', storeKey: 'openai-codex:unknown' },
          { name: 'later', storeKey: 'openai-codex:later' },
        ],
        loadAccount: (key) => key.endsWith('unknown') ? {} : { codexHome: `/homes/${key}` },
        readObservedAt: () => undefined,
        fetch: async () => {},
        observe: (event, data) => { observed.push({ event, data }); },
      },
    });

    expect(result.accounts).toEqual([
      { account: 'unknown', status: 'missing-home' },
      { account: 'later', status: 'refreshed' },
    ]);
    expect(accountFailedEvents(observed)).toEqual([]);
  });

  test('failure reason redacts Authorization Bearer secrets', async () => {
    const observed: Observed[] = [];
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz012345';
    await refreshCodexQuotaSignals({
      deps: {
        now: () => 1_000_000,
        listAccounts: () => [
          { name: 'leaky', storeKey: 'openai-codex:leaky' },
        ],
        loadAccount: (key) => ({ codexHome: `/homes/${key}` }),
        readObservedAt: () => undefined,
        fetch: async () => {
          throw new Error(`Authorization: Bearer ${secret}`);
        },
        observe: (event, data) => { observed.push({ event, data }); },
      },
    });

    const failures = accountFailedEvents(observed);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.data.account).toBe('leaky');
    expect(String(failures[0]!.data.reason)).not.toContain(secret);
    expect(String(failures[0]!.data.reason)).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });

  test('a throwing failed observation still records failed and continues', async () => {
    const observed: Observed[] = [];
    const fetched: string[] = [];
    const result = await refreshCodexQuotaSignals({
      deps: {
        now: () => 1_000_000,
        listAccounts: () => [
          { name: 'broken', storeKey: 'openai-codex:broken' },
          { name: 'later', storeKey: 'openai-codex:later' },
        ],
        loadAccount: (key) => ({ codexHome: `/homes/${key}` }),
        readObservedAt: () => undefined,
        fetch: async (home) => {
          fetched.push(home);
          if (home.endsWith('broken')) throw new Error('measurement failed');
        },
        observe: (event, data) => {
          if (event === 'account-failed') throw new Error('observe failed');
          observed.push({ event, data });
        },
      },
    });

    expect(result.accounts).toEqual([
      { account: 'broken', status: 'failed' },
      { account: 'later', status: 'refreshed' },
    ]);
    expect(fetched).toEqual(['/homes/openai-codex:broken', '/homes/openai-codex:later']);
    expect(accountFailedEvents(observed)).toEqual([]);
    expect(completedEvents(observed)).toEqual([
      {
        event: 'completed',
        data: {
          total: 2,
          fresh: 0,
          refreshed: 1,
          failed: 1,
          'missing-home': 0,
          'timed-out': 0,
          'skipped-by-cap': 0,
          skipped: 0,
        },
      },
    ]);
  });

  test('completed aggregation fields stay numeric counts without a failure array', async () => {
    const observed: Observed[] = [];
    await refreshCodexQuotaSignals({
      deps: {
        now: () => 1_000_000,
        listAccounts: () => [
          { name: 'broken', storeKey: 'openai-codex:broken' },
          { name: 'later', storeKey: 'openai-codex:later' },
        ],
        loadAccount: (key) => ({ codexHome: `/homes/${key}` }),
        readObservedAt: () => undefined,
        fetch: async (home) => {
          if (home.endsWith('broken')) throw new Error('measurement failed');
        },
        observe: (event, data) => { observed.push({ event, data }); },
      },
    });

    expect(completedEvents(observed)).toEqual([
      {
        event: 'completed',
        data: {
          total: 2,
          fresh: 0,
          refreshed: 1,
          failed: 1,
          'missing-home': 0,
          'timed-out': 0,
          'skipped-by-cap': 0,
          skipped: 0,
        },
      },
    ]);
  });
});

// ── 두 실패가 «다른 사건»이고 «같은 거르개»를 쓰는가 (병합 뒤 부모 정정 · 2026-09-10) ──
//
// ⛔ 병합된 첫 판은 계정별 실패와 모듈 전체 실패가 «둘 다» `observe('failed')` 였고,
//   거르개(`redactSecretText`)는 계정 경로에만 붙어 있었다. ⇒ 조회에서 두 뜻이 뭉개지고,
//   전체 실패 경로로는 비밀이 «그대로» 나간다. 이 describe 가 그 둘을 «각각» 문다.
describe('refreshCodexQuotaSignals — the two failure layers are separate events', () => {
  const SECRET = 'sk-abcdefghijklmnopqrstuvwxyz012345';

  test('a listAccounts failure emits refresh-failed (not account-failed) and redacts the reason', async () => {
    const observed: Observed[] = [];
    const thrown = await refreshCodexQuotaSignals({
      deps: {
        now: () => 1_000_000,
        listAccounts: () => { throw new Error(`store unreadable Authorization: Bearer ${SECRET}`); },
        observe: (event, data) => { observed.push({ event, data }); },
      },
    }).catch((err: unknown) => err);

    expect(thrown).toBeInstanceOf(Error);
    // 📌 층이 갈린다 — 이것은 「전부 죽었다」이지 「계정 하나가 실패했다」가 아니다.
    expect(observed.map((item) => item.event)).toEqual(['refresh-failed']);
    expect(accountFailedEvents(observed)).toHaveLength(0);
    // 📌 거르개가 «양쪽»에 붙어 있다.
    expect(String(observed[0]?.data.reason)).not.toContain(SECRET);
    expect(String(observed[0]?.data.reason)).toContain('store unreadable');
  });

  test('a per-account failure emits account-failed and never refresh-failed', async () => {
    const observed: Observed[] = [];
    await refreshCodexQuotaSignals({
      deps: {
        now: () => 1_000_000,
        listAccounts: () => [{ name: 'broken', storeKey: 'openai-codex:broken' }],
        loadAccount: (key) => ({ codexHome: `/homes/${key}` }),
        readObservedAt: () => undefined,
        fetch: async () => { throw new Error(`fetch died Authorization: Bearer ${SECRET}`); },
        observe: (event, data) => { observed.push({ event, data }); },
      },
    });

    expect(observed.some((item) => item.event === 'refresh-failed')).toBe(false);
    expect(accountFailedEvents(observed)).toHaveLength(1);
    expect(String(accountFailedEvents(observed)[0]?.data.reason)).not.toContain(SECRET);
  });
});
