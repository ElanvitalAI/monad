// H6 P1 Bundle 1 · Codex fetcher mapping tests.
//
// We use the `fetchImpl` seam to avoid spawning the codex binary in
// CI — the mapping logic is the part that matters here; the
// spawn/JSON-RPC framing is covered by the existing acp tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodexFetcher as createCodexFetcherWithStorage } from '../../src/budget/fetchers/codex';

// ⛔⭐⭐ 이 파일은 이제 «디스크에 신호를 남기는» 경로를 탄다(quota signal).
//   격리하지 않으면 실제 `~/.monad/budget/…` 을 덮어써 운영 상태와 다른 테스트를 오염시킨다(2R must-fix).
//   ⊕ env 를 «복원»한다 — 안 하면 같은 프로세스의 뒤 테스트가 실행 «순서»에 의존한다(2R should-fix).
let stateDir: string;
const createCodexFetcher = (opts: Parameters<typeof createCodexFetcherWithStorage>[0] = {}) =>
  createCodexFetcherWithStorage({ ...opts, quotaSignalStorage: { root: stateDir } });
let priorStateDir: string | undefined;
beforeEach(() => {
  priorStateDir = process.env.MONAD_STATE_DIR;
  stateDir = mkdtempSync(join(tmpdir(), 'codex-fetcher-'));
  process.env.MONAD_STATE_DIR = join(stateDir, 'unrelated-instance-state');
});
afterEach(() => {
  if (priorStateDir === undefined) delete process.env.MONAD_STATE_DIR;
  else process.env.MONAD_STATE_DIR = priorStateDir;
  try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('codex fetcher mapping', () => {
  test('maps primary+secondary rate limits to session+weekly windows', async () => {
    const fetcher = createCodexFetcher({
      fetchImpl: async () => ({
        rateLimits: {
          primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1_730_000_000 },
          secondary: { usedPercent: 40, windowDurationMins: 10_080, resetsAt: 1_730_500_000 },
          rateLimitReachedType: null,
        },
      }),
    });
    const snap = await fetcher.fetch();
    expect(snap.provider).toBe('codex');
    expect(snap.source).toBe('cli-rpc');
    expect(snap.windows.length).toBe(2);
    expect(snap.windows[0]?.kind).toBe('session');
    expect(snap.windows[0]?.used).toBe(25);
    expect(snap.windows[0]?.remainingPercent).toBe(75);
    expect(snap.windows[1]?.kind).toBe('weekly');
  });

  // ⛔⭐⭐⭐ 2026-08-05 실측 회귀 — 실물 응답은 `primary` 가 «주간»(10080분)이고 `secondary` 는 null 이었다.
  //   초판은 «자리»로 종류를 못 박아 주간 창을 「session」이라 불렀다.
  test('derives window kind from duration, not position (2026-08-05 실측 형태)', async () => {
    const fetcher = createCodexFetcher({
      fetchImpl: async () => ({
        rateLimits: {
          limitId: 'codex',
          primary: { usedPercent: 100, windowDurationMins: 10_080, resetsAt: 1_786_163_948 },
          secondary: null,
          credits: { hasCredits: true, unlimited: false, balance: '3772.79' },
          planType: 'pro',
          rateLimitReachedType: 'rate_limit_reached',
        },
      }),
    });
    const snap = await fetcher.fetch();
    expect(snap.windows.length).toBe(1);
    expect(snap.windows[0]?.kind).toBe('weekly');        // ⛔ 'session' 이면 회귀다
    expect(snap.windows[0]?.windowMinutes).toBe(10_080);
    expect(snap.rateLimitReached).toBe('rate_limit_reached');
    expect(snap.plan).toBe('pro');
    expect(snap.credits?.balance).toBeCloseTo(3772.79, 2);
    expect(snap.credits?.hasCredits).toBe(true);
  });

  // ⭐ 모델별 서브리밋은 브랜드 총량과 «따로» 찬다(실측: 주간 100% 인데 그 버킷은 0%).
  test('carries per-model buckets as model-labelled windows and drops the duplicate brand bucket', async () => {
    const fetcher = createCodexFetcher({
      fetchImpl: async () => ({
        rateLimits: {
          limitId: 'codex',
          primary: { usedPercent: 100, windowDurationMins: 10_080, resetsAt: 1_786_163_948 },
          secondary: null,
        },
        rateLimitsByLimitId: {
          codex: { limitId: 'codex', primary: { usedPercent: 100, windowDurationMins: 10_080, resetsAt: 1 } },
          codex_bengalfox: {
            limitId: 'codex_bengalfox',
            limitName: 'GPT-5.3-Codex-Spark',
            primary: { usedPercent: 0, windowDurationMins: 10_080, resetsAt: 1_786_509_224 },
            secondary: null,
          },
        },
      }),
    });
    const snap = await fetcher.fetch();
    const labelled = snap.windows.filter((w) => w.model !== undefined);
    expect(labelled.length).toBe(1);                          // ⛔ 브랜드 중복(codex)은 빠진다
    expect(labelled[0]?.model).toBe('GPT-5.3-Codex-Spark');
    expect(labelled[0]?.used).toBe(0);                        // 총량 100% 여도 이 버킷은 0
    expect(snap.windows.filter((w) => w.model === undefined).length).toBe(1);
    const signal = JSON.parse(readFileSync(join(stateDir, 'budget', readdirSync(join(stateDir, 'budget'))[0]), 'utf8'));
    expect(signal.usedPercent).toBe(100);                         // ⛔ 모델별 0%가 총량 신호를 덮지 않는다
  });

  test('writes the largest model-less usage and omits it when no brand window exists', async () => {
    const fetcher = createCodexFetcher({
      fetchImpl: async () => ({
        rateLimits: {
          limitId: 'codex',
          primary: { usedPercent: 72, windowDurationMins: 300, resetsAt: 1 },
          secondary: { usedPercent: 96, windowDurationMins: 10_080, resetsAt: 1 },
        },
      }),
    });
    await fetcher.fetch();
    const path = join(stateDir, 'budget', readdirSync(join(stateDir, 'budget'))[0]);
    expect(JSON.parse(readFileSync(path, 'utf8')).usedPercent).toBe(96);

    const none = createCodexFetcher({ fetchImpl: async () => ({}) });
    await none.fetch();
    expect(JSON.parse(readFileSync(path, 'utf8')).usedPercent).toBeUndefined();
  });

  test('leaves rateLimitReached undefined when the provider does not say it is reached', async () => {
    const fetcher = createCodexFetcher({
      fetchImpl: async () => ({
        rateLimits: { primary: { usedPercent: 99, windowDurationMins: 300, resetsAt: 1 }, rateLimitReachedType: null },
      }),
    });
    const snap = await fetcher.fetch();
    // ⛔ used 99 로 «추론하지 않는다» — 공급자 판정이 권위다
    expect(snap.rateLimitReached).toBeUndefined();
  });

  // ⛔⭐⭐⭐ **배선을 «무는» 테스트**(2R must-fix) — 이것이 없으면 `writeQuotaSignal(...)` 한 줄을
  //   지워도 모든 테스트가 통과한다. 그 한 줄이 headless 하니스에서 이 기능이 «도는 유일한 이유»다.
  test('fetch 가 성공하면 쿼터 신호를 «디스크에» 남긴다 (판정층이 읽는 유일한 자리)', async () => {
    const reached = createCodexFetcher({
      fetchImpl: async () => ({
        rateLimits: { primary: { usedPercent: 100, windowDurationMins: 10_080, resetsAt: 1 }, rateLimitReachedType: 'rate_limit_reached' },
      }),
    });
    await reached.fetch();
    // ⛔ 파일 «이름»을 짐작하지 않는다 — 신호는 「어느 홈을 잰 것인가」로 키가 갈리므로
    //   이름은 해시다(2026-08-05). 디렉터리에 «하나»가 생겼는지로 찾는다.
    const dir = join(stateDir, 'budget');
    const files = readdirSync(dir).filter((f) => f.startsWith('codex-quota-signal'));
    expect(files.length).toBe(1);
    const path = join(dir, files[0]);
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8')).rateLimitReached).toBe('rate_limit_reached');

    // 안 찬 상태도 «기록»한다 — 그래야 낡은 「찼다」가 계속 살아남지 않는다
    const clear = createCodexFetcher({
      fetchImpl: async () => ({ rateLimits: { primary: { usedPercent: 3, windowDurationMins: 10_080, resetsAt: 1 }, rateLimitReachedType: null } }),
    });
    await clear.fetch();
    expect(JSON.parse(readFileSync(path, 'utf8')).rateLimitReached).toBeNull();
  });

  test('omits missing window positions', async () => {
    const fetcher = createCodexFetcher({
      fetchImpl: async () => ({
        rateLimits: {
          primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1_730_000_000 },
          secondary: null,
        },
      }),
    });
    const snap = await fetcher.fetch();
    expect(snap.windows.length).toBe(1);
    expect(snap.windows[0]?.kind).toBe('session');
  });

  test('converts unix seconds resetsAt to epoch ms', async () => {
    const fetcher = createCodexFetcher({
      fetchImpl: async () => ({
        rateLimits: {
          primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 1_730_000_000 },
        },
      }),
    });
    const snap = await fetcher.fetch();
    expect(snap.windows[0]?.resetsAt).toBe(1_730_000_000_000);
  });

  test('passes through already-ms resetsAt unchanged', async () => {
    const fetcher = createCodexFetcher({
      fetchImpl: async () => ({
        rateLimits: {
          primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 1_730_000_000_000 },
        },
      }),
    });
    const snap = await fetcher.fetch();
    expect(snap.windows[0]?.resetsAt).toBe(1_730_000_000_000);
  });

  test('clamps usedPercent into 0..100 range', async () => {
    const fetcher = createCodexFetcher({
      fetchImpl: async () => ({
        rateLimits: {
          primary: { usedPercent: 150, windowDurationMins: 300, resetsAt: 1_730_000_000 },
        },
      }),
    });
    const snap = await fetcher.fetch();
    expect(snap.windows[0]?.used).toBe(100);
    expect(snap.windows[0]?.remainingPercent).toBe(0);
  });

  test('returns empty windows when rateLimits absent (lenient)', async () => {
    const fetcher = createCodexFetcher({
      fetchImpl: async () => ({}),
    });
    const snap = await fetcher.fetch();
    expect(snap.windows.length).toBe(0);
  });

  test('propagates fetchImpl errors', async () => {
    const fetcher = createCodexFetcher({
      fetchImpl: async () => {
        throw new Error('codex app-server unavailable');
      },
    });
    await expect(fetcher.fetch()).rejects.toThrow('codex app-server unavailable');
  });

  test('aborting a bounded fetch kills and closes the app-server child', async () => {
    const controller = new AbortController();
    let killed = 0;
    let closed = 0;
    let rejectRequest: ((error: Error) => void) | undefined;
    const request = new Promise<never>((_resolve, reject) => { rejectRequest = reject; });
    const fetcher = createCodexFetcher({
      signal: controller.signal,
      spawnImpl: (() => ({
        child: { kill: () => { killed++; rejectRequest?.(new Error('aborted')); } },
        client: {
          request: async () => request,
          close: async () => { closed++; },
        },
      })) as never,
    });

    const pending = fetcher.fetch();
    controller.abort();
    await expect(pending).rejects.toThrow('aborted');
    // ⛔ 리뷰 should-fix — `>= 1` 은 «중복 kill» 회귀를 통과시킨다(abort 리스너가 두 번 붙거나
    //   해제가 빠져도 안 걸린다). 정확히 «한 번»을 문다.
    expect(killed).toBe(1);
    expect(closed).toBe(1);
  });

  // ⛔⭐ 리뷰 should-fix — 이미 끊긴 signal 이면 «자식을 띄우지도» 말아야 한다.
  //   종전엔 spawn 하고 initialize 까지 보낸 뒤 죽였다(상한을 지키자는 변경이 남긴 구멍).
  test('an already-aborted signal never spawns the app-server child', async () => {
    let spawns = 0;
    const controller = new AbortController();
    controller.abort();
    await expect(createCodexFetcher({
      signal: controller.signal,
      spawnImpl: (() => { spawns++; throw new Error('must not spawn'); }) as never,
    }).fetch()).rejects.toThrow(/aborted before spawn/);
    expect(spawns).toBe(0);
  });
});
