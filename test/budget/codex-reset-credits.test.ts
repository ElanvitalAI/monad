import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { debug } from '../../src/debug/log';
import { elanousStateRoot } from '../../src/autopilot/state-paths';
import { effectiveCodexHome, resolveCodexAccount } from '../../src/oauth/codex-account';
import { authStorePath } from '../../src/oauth/store';
import { describeResetCreditExpiry, writeAvailabilityState, quotaSignalDir, readQuotaSignal, writeQuotaSignal,
  codexCredentialRoot,
} from '../../src/budget/codex-reset-credit-state';
import { classifyResetCreditAvailability, consumeCodexResetCredits, listCodexResetCredits, observeResetCreditAvailability } from '../../src/budget/codex-reset-credits';
import { collectUnifiedUsage, formatUnifiedUsage } from '../../src/budget/unified-usage';
import type { UsageSnapshot } from '../../src/budget/types';

const credit = {
  id: 'credit-1',
  status: 'available',
  granted_at: '2026-08-05T00:00:00Z',
  expires_at: '2026-08-12T00:00:00Z',
  redeem_started_at: null,
  redeemed_at: null,
  title: 'Weekly reset',
  description: 'Reset weekly limit',
};

async function authFile(): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), 'codex-reset-credits-')), 'auth.json');
  await writeFile(path, JSON.stringify({ tokens: { access_token: 'test-token', account_id: 'account-1' } }));
  return path;
}

async function expectMissingAuthPath(env: NodeJS.ProcessEnv, expectedPath: string): Promise<void> {
  // 빈 elanous 저장소 — 파일을 못 읽을 때의 저장소 대체(#20263 ④)가 «이 기계의 실제 저장소»를 읽지 않게.
  const emptyStore = join(await mkdtemp(join(tmpdir(), 'codex-empty-store-')), 'auth.json');
  const result = await listCodexResetCredits({ env, authStorePath: emptyStore });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.message).toContain(expectedPath);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function tokenWithAccountId(accountId: string): string {
  const payload = Buffer.from(JSON.stringify({
    'https://api.openai.com/auth': { chatgpt_account_id: accountId },
  })).toString('base64url');
  return `header.${payload}.signature`;
}

describe('Codex reset credits', () => {
  test('lists credits with authenticated GET headers and records success', async () => {
    const path = await authFile();
    const logs: unknown[][] = [];
    const originalLog = debug.log;
    debug.log = ((...args: unknown[]) => { logs.push(args); }) as typeof debug.log;
    try {
      const result = await listCodexResetCredits({
        authFilePath: path,
        fetchImpl: async (url, init) => {
          expect(String(url)).toBe('https://chatgpt.com/backend-api/wham/rate-limit-reset-credits');
          expect(init?.method).toBe('GET');
          expect(init?.headers).toMatchObject({
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
            originator: 'Codex Desktop',
            'OAI-Product-Sku': 'CODEX',
            'chatgpt-account-id': 'account-1',
          });
          return json({ credits: [credit], available_count: 1, total_earned_count: 2 });
        },
      });
      expect(result).toEqual({ ok: true, value: { credits: [credit], availableCount: 1, totalEarnedCount: 2 } });
      expect(logs.some((entry) => entry[1] === 'list-succeeded')).toBe(true);
    } finally {
      debug.log = originalLog;
    }
  });

  test('uses ELANOUS_CODEX_ACCOUNT_HOME auth path for the selected account', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'codex-account-home-'));
    try {
      await expectMissingAuthPath(
        { ELANOUS_CODEX_ACCOUNT: 'b', ELANOUS_CODEX_ACCOUNT_HOME: codexHome },
        join(codexHome, 'auth.json'),
      );
    } finally {
      rmSync(codexHome, { recursive: true, force: true });
    }
  });

  test('uses the shared effective home when the selected account has a stored mirror', async () => {
    const declaredHome = await mkdtemp(join(tmpdir(), 'codex-account-declared-home-'));
    const storedHome = await mkdtemp(join(tmpdir(), 'codex-account-stored-home-'));
    const configHome = await mkdtemp(join(tmpdir(), 'codex-account-config-'));
    const priorXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = configHome;
    try {
      await mkdir(dirname(authStorePath()), { recursive: true });
      await writeFile(authStorePath(), JSON.stringify({
        version: 1,
        providers: { 'openai-codex:b': { codexHome: storedHome } },
      }));
      await expectMissingAuthPath(
        { ELANOUS_CODEX_ACCOUNT: 'b', ELANOUS_CODEX_ACCOUNT_HOME: declaredHome },
        join(storedHome, 'auth.json'),
      );
    } finally {
      if (priorXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = priorXdg;
      rmSync(declaredHome, { recursive: true, force: true });
      rmSync(storedHome, { recursive: true, force: true });
      rmSync(configHome, { recursive: true, force: true });
    }
  });

  test('uses CODEX_HOME auth path for the default account', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'codex-home-'));
    try {
      await expectMissingAuthPath({ CODEX_HOME: codexHome }, join(codexHome, 'auth.json'));
    } finally {
      rmSync(codexHome, { recursive: true, force: true });
    }
  });

  test('resolves ~/.codex/auth.json when no Codex home environment is supplied', () => {
    const env = {};
    const account = resolveCodexAccount(env);
    const home = effectiveCodexHome(account, null, env).home;
    expect(join(home!, 'auth.json')).toBe(join(homedir(), '.codex', 'auth.json'));
  });

  test('consumes a server-selected credit with the supplied idempotency key and records success', async () => {
    const path = await authFile();
    const logs: unknown[][] = [];
    const originalLog = debug.log;
    debug.log = ((...args: unknown[]) => { logs.push(args); }) as typeof debug.log;
    try {
      const result = await consumeCodexResetCredits({
        authFilePath: path,
        redeemRequestId: 'request-123',
        fetchImpl: async (url, init) => {
          expect(String(url)).toBe('https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume');
          expect(init?.method).toBe('POST');
          expect(JSON.parse(String(init?.body))).toEqual({ redeem_request_id: 'request-123' });
          return json({ code: 'reset', credit: { ...credit, status: 'redeemed', redeemed_at: '2026-08-05T01:00:00Z' } });
        },
      });
      expect(result).toMatchObject({ ok: true, redeemRequestId: 'request-123', value: { code: 'reset', credit: { status: 'redeemed' } } });
      expect(logs.some((entry) => entry[1] === 'consume-succeeded')).toBe(true);
    } finally {
      debug.log = originalLog;
    }
  });

  test('generates an idempotency key when the caller does not supply one', async () => {
    const path = await authFile();
    const result = await consumeCodexResetCredits({
      authFilePath: path,
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(typeof body.redeem_request_id).toBe('string');
        expect(body.redeem_request_id.length).toBeGreaterThan(0);
        return json({ code: 'reset', credit: { ...credit, status: 'redeemed', redeemed_at: '2026-08-05T01:00:00Z' } });
      },
    });
    expect(result).toMatchObject({ ok: true, value: { code: 'reset' } });
  });

  test('returns request failures as values and records failure', async () => {
    const path = await authFile();
    const logs: unknown[][] = [];
    const originalLog = debug.log;
    debug.log = ((...args: unknown[]) => { logs.push(args); }) as typeof debug.log;
    try {
      const result = await listCodexResetCredits({ authFilePath: path, fetchImpl: async () => json({ error: 'nope' }, 401) });
      expect(result).toMatchObject({ ok: false, kind: 'request', response: { error: 'nope' } });
      expect(logs.some((entry) => entry[1] === 'list-failed')).toBe(true);
    } finally {
      debug.log = originalLog;
    }
  });

  test('returns consume failures as values and records failure', async () => {
    const path = await authFile();
    const logs: unknown[][] = [];
    const originalLog = debug.log;
    debug.log = ((...args: unknown[]) => { logs.push(args); }) as typeof debug.log;
    try {
      const result = await consumeCodexResetCredits({
        authFilePath: path,
        redeemRequestId: 'request-failure',
        fetchImpl: async () => json({ error: 'unavailable' }, 503),
      });
      expect(result).toMatchObject({ ok: false, kind: 'request', redeemRequestId: 'request-failure' });
      expect(logs.some((entry) => entry[1] === 'consume-failed')).toBe(true);
    } finally {
      debug.log = originalLog;
    }
  });

  test('returns unexpected response shapes as values without throwing', async () => {
    const path = await authFile();
    const result = await consumeCodexResetCredits({
      authFilePath: path,
      fetchImpl: async () => json({ code: 'changed-contract' }),
    });
    expect(result).toMatchObject({ ok: false, kind: 'response-shape', response: { code: 'changed-contract' } });
  });
});

describe('reset credit availability observation (C · 부여 주기 표본)', () => {
  test('첫 관측은 「부여」로 세지 않는다 — 그 전을 모르기 때문이다', () => {
    expect(classifyResetCreditAvailability(undefined, 1)).toEqual({
      transition: 'first-observation', from: undefined, to: 1, isGrantSample: false,
    });
    // ⛔ 0 으로 대체했다면 이것이 'granted' 로 세어졌을 것이다
    expect(classifyResetCreditAvailability(undefined, 0).transition).toBe('first-observation');
  });

  test('0→1 은 부여 표본이고, 1→0(사용)은 아니다', () => {
    expect(classifyResetCreditAvailability(0, 1)).toEqual({
      transition: 'granted', from: 0, to: 1, isGrantSample: true,
    });
    expect(classifyResetCreditAvailability(1, 0)).toEqual({
      transition: 'consumed', from: 1, to: 0, isGrantSample: false,
    });
    expect(classifyResetCreditAvailability(0, 0).transition).toBe('unchanged');
  });

  test('관측이 직전 값을 읽고 이번 값을 남기며, 읽기 실패는 「모른다」와 같게 다룬다', async () => {
    const written: number[] = [];
    const okList = async () => new Response(JSON.stringify({ credits: [], available_count: 1, total_earned_count: 0 }), { status: 200 });
    const base = { authFilePath: await authFile(), fetchImpl: okList as unknown as typeof fetch };

    const first = await observeResetCreditAvailability({
      ...base, readPrevious: () => 0, writeCurrent: (n) => { written.push(n); },
    });
    expect(first.ok && first.change.transition).toBe('granted');
    expect(written).toEqual([1]);

    const blind = await observeResetCreditAvailability({
      ...base, readPrevious: () => { throw new Error('state unreadable'); },
    });
    // ⛔ 읽기 실패를 0 으로 «채우지 않는다» — 그러면 없는 부여가 생긴다
    expect(blind.ok && blind.change.transition).toBe('first-observation');
  });

  test('저장 실패가 판정을 막지 않는다 (fail-soft)', async () => {
    const okList = async () => new Response(JSON.stringify({ credits: [], available_count: 0, total_earned_count: 0 }), { status: 200 });
    const r = await observeResetCreditAvailability({
      authFilePath: await authFile(),
      fetchImpl: okList as unknown as typeof fetch,
      readPrevious: () => 1,
      writeCurrent: () => { throw new Error('disk full'); },
    });
    expect(r.ok).toBe(true);
    expect(r.ok && r.change.transition).toBe('consumed');
  });
});

describe('reset credit expiry (현재 응답만 읽는 순수 판정)', () => {
  const now = Date.parse('2026-08-10T00:00:00Z');
  const near = { ...credit, expires_at: '2026-08-11T00:00:00Z' };
  const far = { ...credit, expires_at: '2026-08-20T00:00:00Z' };

  test('가까운 만료와 정확한 경계 시각을 드러내며 가장 이른 가용 권리를 고른다', () => {
    expect(describeResetCreditExpiry([far, near], 24 * 60 * 60 * 1000, now)).toEqual({
      status: 'expiring-soon', expiresAt: '2026-08-11T00:00:00.000Z', hasUnknownExpiry: false,
    });
  });

  test('먼 만료는 임박이라고 하지 않고, 이미 지난 시각은 별도로 만료다', () => {
    expect(describeResetCreditExpiry([far], 24 * 60 * 60 * 1000, now)).toMatchObject({ status: 'available' });
    expect(describeResetCreditExpiry([{ ...credit, expires_at: '2026-08-09T00:00:00Z' }], 1, now)).toMatchObject({ status: 'expired' });
  });

  test('소진 권리는 제외하고, 없거나 미상·잘못된 만료는 각각 구별한다', () => {
    expect(describeResetCreditExpiry([{ ...near, status: 'redeemed' }], 1, now)).toEqual({ status: 'none' });
    expect(describeResetCreditExpiry([{ ...credit, expires_at: null }], 1, now)).toEqual({ status: 'unknown-expiry' });
    expect(describeResetCreditExpiry([{ ...credit, expires_at: 'not-a-date' }], 1, now)).toEqual({ status: 'unknown-expiry' });
  });

  test('경고 창 설정이 없으면 안전하게 unavailable이며 임박하지 않음으로 접지 않는다', () => {
    expect(describeResetCreditExpiry([near], undefined, now)).toEqual({ status: 'unavailable', detail: 'invalid-warning-window' });
  });
});

describe('reset credit expiry unified usage wiring', () => {
  const now = Date.parse('2026-08-10T00:00:00Z');
  const snapshot: UsageSnapshot = { provider: 'codex', fetchedAt: now, source: 'cli-rpc', windows: [] };

  test('계정별 목록의 임박·미상·조회 실패를 분리하고 표에 임박 시각을 낸다', async () => {
    const report = await collectUnifiedUsage({
      now: () => now,
      resetCreditExpiryWarningMs: 24 * 60 * 60 * 1000,
      listCodexAccounts: () => [
        { name: 'near', storeKey: 'near' }, { name: 'unknown', storeKey: 'unknown' }, { name: 'failed', storeKey: 'failed' },
      ],
      loadCodexHome: (key) => `/tmp/${key}`,
      fetchCodex: async () => snapshot,
      listCodexResetCredits: async ({ env }) => {
        if (env?.CODEX_HOME === '/tmp/near') return { ok: true, value: { credits: [{ ...credit, expires_at: '2026-08-11T00:00:00Z' }], availableCount: 1, totalEarnedCount: 1 } };
        if (env?.CODEX_HOME === '/tmp/unknown') return { ok: true, value: { credits: [{ ...credit, expires_at: null }], availableCount: 1, totalEarnedCount: 1 } };
        return { ok: false, kind: 'request', message: 'offline' };
      },
      fetchGrok: async () => ({ status: 'no-subscription' }),
    });
    expect(report.rows.filter((row) => row.provider === 'codex').map((row) => row.resetCredits.status)).toEqual([
      'expiring-soon', 'unknown-expiry', 'unavailable',
    ]);
    const text = formatUnifiedUsage(report);
    expect(text).toContain('EXPIRING-SOON expires=2026-08-11T00:00:00.000Z');
    expect(text).toContain('available expiry=unknown');
    expect(text).toContain('unavailable (request)');
  });

  test('usage와 리셋권 조회 실패는 역방향으로 격리되어 성공 축을 보존한다', async () => {
    const report = await collectUnifiedUsage({
      now: () => now,
      resetCreditExpiryWarningMs: 24 * 60 * 60 * 1000,
      listCodexAccounts: () => [
        { name: 'usage-failed', storeKey: 'usage-failed' },
        { name: 'expiry-failed', storeKey: 'expiry-failed' },
      ],
      loadCodexHome: (key) => `/tmp/${key}`,
      fetchCodex: async (opts) => {
        if (opts.codexHome === '/tmp/usage-failed') throw new Error('usage offline');
        return snapshot;
      },
      listCodexResetCredits: async ({ env }) => {
        if (env?.CODEX_HOME === '/tmp/usage-failed') {
          return { ok: true, value: { credits: [{ ...credit, expires_at: '2026-08-11T00:00:00Z' }], availableCount: 1, totalEarnedCount: 1 } };
        }
        return { ok: false, kind: 'request', message: 'reset offline' };
      },
      fetchGrok: async () => ({ status: 'no-subscription' }),
    });
    const [usageFailed, expiryFailed] = report.rows.filter((row) => row.provider === 'codex');
    expect(usageFailed.credits).toMatchObject({ status: 'error', detail: 'usage offline' });
    expect(usageFailed.resetCredits).toEqual({
      status: 'expiring-soon', expiresAt: '2026-08-11T00:00:00.000Z', hasUnknownExpiry: false,
    });
    expect(expiryFailed.credits).toMatchObject({ status: 'ok' });
    expect(expiryFailed.resetCredits).toEqual({ status: 'unavailable', detail: 'request' });
  });
});

describe('quota signal (디스크 경유 · 판정층이 읽는 유일한 자리)', () => {
  // ⛔ env 를 «복원»한다 — 안 하면 뒤 테스트가 실행 순서에 의존한다(2R should-fix).
  let priorStateDir: string | undefined;
  let priorHome: string | undefined;
  const madeDirs: string[] = [];
  beforeEach(() => {
    priorStateDir = process.env.ELANOUS_STATE_DIR;
    priorHome = process.env.HOME;
  });
  afterEach(() => {
    if (priorStateDir === undefined) delete process.env.ELANOUS_STATE_DIR;
    else process.env.ELANOUS_STATE_DIR = priorStateDir;
    if (priorHome === undefined) delete process.env.HOME;
    else process.env.HOME = priorHome;
    // ⛔ 만든 것은 «치운다»(4R must-fix) — 다른 파일만 고치고 여기를 빼먹었다
    for (const d of madeDirs.splice(0)) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } }
  });

  async function isolated(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'quota-signal-'));
    madeDirs.push(dir);
    process.env.ELANOUS_STATE_DIR = dir;   // ⛔ 실제 ~/.elanous 를 절대 안 건드린다
    return dir;
  }

  test('찼다고 관측된 신호는 true, 안 찼다는 undefined — ⛔ false 로 뭉개지 않는다', async () => {
    await isolated();
    writeQuotaSignal('rate_limit_reached');
    expect(readQuotaSignal()).toBe(true);
    writeQuotaSignal(undefined);
    expect(readQuotaSignal()).toBeUndefined();
  });

  test('암시적 쓰기는 격리 상태 뿌리에만 남기고 가짜 운영 홈은 건드리지 않는다', async () => {
    const stateRoot = await isolated();
    const fakeHome = await mkdtemp(join(tmpdir(), 'quota-signal-home-'));
    madeDirs.push(fakeHome);
    process.env.HOME = fakeHome;

    writeQuotaSignal('rate_limit_reached');

    expect(readdirSync(join(stateRoot, 'budget'))).toHaveLength(1);
    expect(existsSync(join(fakeHome, '.elanous', 'budget'))).toBe(false);
  });

  test('암시적 읽기는 격리 신호를 읽고 별도 운영 뿌리 신호는 읽지 않는다', async () => {
    await isolated();
    const operatingRoot = await mkdtemp(join(tmpdir(), 'quota-signal-operating-'));
    madeDirs.push(operatingRoot);
    writeQuotaSignal('rate_limit_reached', undefined, undefined, { root: operatingRoot });

    expect(readQuotaSignal()).toBeUndefined();
    writeQuotaSignal('rate_limit_reached');
    expect(readQuotaSignal()).toBe(true);
  });

  test('명시 저장소는 충돌하는 격리 상태 뿌리보다 읽기와 쓰기 모두에서 우선한다', async () => {
    const stateRoot = await isolated();
    const explicitRoot = await mkdtemp(join(tmpdir(), 'quota-signal-explicit-'));
    madeDirs.push(explicitRoot);
    const storage = { root: explicitRoot };

    writeQuotaSignal('rate_limit_reached', undefined, undefined, storage);

    expect(readdirSync(join(explicitRoot, 'budget'))).toHaveLength(1);
    expect(existsSync(join(stateRoot, 'budget'))).toBe(false);
    expect(readQuotaSignal(Date.now(), undefined, storage)).toBe(true);
    expect(readQuotaSignal()).toBeUndefined();
  });

  // ⛔⭐⭐⭐ **계약이 «바뀌었다**(2026-08-19 · 🅢 실측 → 🅣 수리). 옛 문면은 아래와 같았다:
  //   *"격리 지정이 없으면 quota 경로는 정식 resolver 의 운영 fallback 을 그대로 쓴다"*
  //   ⇒ 즉 ***파생 우주(트리에서 자동으로 갈리는 `.elanous-test`)까지 신호를 갈랐다.***
  // 🚨 그 결과: 자식 워크트리가 ***아무도 갱신하지 않는 자기 신호***를 읽어 «19시간» 낡은 값을 보고,
  //   회전이 `usedPercent=unknown` 으로 판단해 ***이미 100% 인 계정을 골라*** 429 로 죽었다(골 둘).
  // ⇒ 🔑 새 계약: ***「누가 격리를 «말했나»」***로 가른다.
  //   ⓐ `ELANOUS_STATE_DIR` 명시 ⇒ 존중(그 위 테스트가 그것을 문다)
  //   ⓑ 말한 적 없음        ⇒ ***자격(`auth.json`)과 «같은 뿌리»*** — 자격이 안 갈리므로 상태도 안 갈린다
  // ⛔⭐ **세 자리가 «한 규칙»을 쓰는지** — auth · quota signal · reset credit.
  //   📏 실측(2026-08-19): reset-credit 은 «이미» 옳은 규칙이었는데 `XDG_CONFIG_HOME` 만 «안» 봤다
  //     ⇒ XDG 환경에서 자격은 `$XDG/elanous/auth.json`, 상태는 `~/.elanous/budget` 으로 «또» 갈렸다.
  test('⛔ XDG 환경에서도 자격과 상태가 «같은 뿌리»다 — 세 자리가 한 규칙을 쓴다', () => {
    delete process.env.ELANOUS_STATE_DIR;
    const priorXdg = process.env.XDG_CONFIG_HOME;
    const xdgRoot = mkdtempSync(join(tmpdir(), 'xdg-root-'));
    process.env.XDG_CONFIG_HOME = xdgRoot;
    try {
      expect(codexCredentialRoot()).toBe(join(xdgRoot, 'elanous'));
      expect(quotaSignalDir()).toBe(join(xdgRoot, 'elanous', 'budget'));
      // ⭐ auth 와 «같은 부모»여야 한다 — 이 단언이 「세 자리가 한 규칙」의 본체다
      expect(dirname(authStorePath())).toBe(codexCredentialRoot());
      // ⛔⭐ **셋째 자리(reset credit)는 경로 함수가 «비공개»라 직접 못 묻는다** —
      //   그래서 ***파일이 «어디에» 생기나***로 문다. 이 단언이 없으면 그 자리만 조용히 갈릴 수 있다.
      //   ⚠️ 회귀가 나면 이 테스트는 «사람의 진짜 ~/.elanous/budget 에 파일을 하나 만들고» 실패한다 —
      //     그것이 바로 이 테스트가 잡으려는 «그 결함»이라 감수한다.
      writeAvailabilityState(3, join(xdgRoot, 'fake-codex-home'));
      expect(readdirSync(join(xdgRoot, 'elanous', 'budget')).some((f) => f.startsWith('codex-reset-credit-availability-'))).toBe(true);
    } finally {
      if (priorXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = priorXdg;
      try { rmSync(xdgRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });

  test('⛔ 격리를 «말한 적 없으면» quota 경로는 자격과 «같은 뿌리»다 — 파생 우주로 안 갈린다', () => {
    delete process.env.ELANOUS_STATE_DIR;
    expect(quotaSignalDir()).toBe(join(codexCredentialRoot(), 'budget'));
    // ⭐ 그리고 그것은 ***파생 우주와 «다르다»*** — 이 단언이 회귀의 «본체»다.
    //   (파생이 실제로 갈려 있을 때만 유효하므로, 같으면 이 축은 「측정 불가」로 넘어간다)
    if (elanousStateRoot() !== codexCredentialRoot()) {
      expect(quotaSignalDir()).not.toBe(join(elanousStateRoot(), 'budget'));
    }
  });

  test('낡은 신호는 「지금 사실」이 아니다 — 나이 상한을 넘으면 undefined', async () => {
    await isolated();
    writeQuotaSignal('rate_limit_reached');
    expect(readQuotaSignal(Date.now() + 59 * 60 * 1000)).toBe(true);        // 59분 — 아직 유효
    expect(readQuotaSignal(Date.now() + 61 * 60 * 1000)).toBeUndefined();   // 61분 — 모른다
  });

  test('미래 시각(음수 age)은 «손상»으로 거부한다 — 시계가 뒤로 간 상태를 신선함으로 읽지 않는다', async () => {
    await isolated();
    writeQuotaSignal('rate_limit_reached');
    // 관측 시각이 «지금보다 미래»가 되도록 기준 시각을 과거로 준다
    expect(readQuotaSignal(Date.now() - 5 * 60 * 1000)).toBeUndefined();
  });

  test('신호 파일이 없으면 undefined (⛔ 없음을 「안 찼다」로 읽지 않는다)', async () => {
    await isolated();
    expect(readQuotaSignal()).toBeUndefined();
  });
});

describe('Codex reset credits — elanous login without a Codex CLI mirror (#20263 ④)', () => {
  test('falls back to the same account token in the elanous auth store when the Codex file is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'codex-store-fallback-'));
    const storePath = join(dir, 'auth.json');
    const token = tokenWithAccountId('acct-store');
    await writeFile(storePath, JSON.stringify({ version: 1, providers: { 'openai-codex': { tokens: { accessToken: token, refreshToken: 'r' }, lastRefresh: '2026-09-24T00:00:00Z', authMode: 'chatgpt' } } }));
    const seen: Record<string, string>[] = [];
    try {
      const result = await listCodexResetCredits({
        env: { CODEX_HOME: join(dir, 'no-codex-home') },
        authStorePath: storePath,
        fetchImpl: async (_url, init) => { seen.push(init?.headers as Record<string, string>); return json({ credits: [credit], available_count: 1, total_earned_count: 1 }); },
      });
      expect(result.ok).toBe(true);
      expect(JSON.stringify(seen[0])).toContain(token);
      expect(JSON.stringify(seen[0])).toContain('acct-store');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an explicit auth file path never falls back to the store', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'codex-store-explicit-'));
    const storePath = join(dir, 'auth.json');
    await writeFile(storePath, JSON.stringify({ version: 1, providers: { 'openai-codex': { tokens: { accessToken: tokenWithAccountId('x'), refreshToken: 'r' }, lastRefresh: 'z', authMode: 'chatgpt' } } }));
    try {
      const result = await listCodexResetCredits({ authFilePath: join(dir, 'missing.json'), authStorePath: storePath, fetchImpl: async () => json({ credits: [] }) });
      expect(result).toMatchObject({ ok: false, kind: 'auth' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
