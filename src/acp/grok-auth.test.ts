// grok-auth.ts 계약 테스트.
//
// ⛔ 여기서 «검증하는 것»과 «검증 못 하는 것»을 먼저 적는다:
//   ✅ 검증한다 — 인증 에러 감지 정규식 · auth.json 만료 파싱(중첩 스코프·「모름」 의미) ·
//                 spawn 인자 선택(브라우저/디바이스) · 타임아웃 · 종료코드 매핑
//   ⛔ 검증 «못» 한다 — 실제 `grok login` 왕복. 브라우저를 띄우고 인증 상태를 바꾸므로
//                 이 스위트는 spawn 을 «전부 모의»한다. ⇒ 「grok login 이 성공 시 정말
//                 exit 0 을 내는가」는 이 파일이 답하지 않는다(RESEARCH 문서 §8a-5).

import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import {
  accountHasRefreshTokenField,
  describeGrokCredentialFreshness,
  grokAuthHint,
  grokAuthPath,
  isGrokAuthError,
  isGrokTokenExpired,
  readGrokTokenFreshness,
  spawnGrokLogin,
} from './grok-auth.js';

// ── 감지 ────────────────────────────────────────────────────────────────────
describe('isGrokAuthError — ref/grok-build 실측 문면 다섯', () => {
  // ⛔ 아래 다섯은 추측이 아니라 ref/grok-build 소스에서 그대로 옮긴 것이다.
  //    파일·행은 RESEARCH-grok-oauth-subscription-delegation-2026-08-13 §4a.
  const REAL_WORDINGS: ReadonlyArray<readonly [string, string]> = [
    ['util/grok_auth_credentials.rs:71', 'Your auth token is invalid or expired. Run `grok login` to re-authenticate.'],
    ['agent/relay.rs:172', 'Authentication required. Run `grok login` to re-authenticate.'],
    ['managed_config/response.rs:45', 'Your team sign-in was rejected. It may have expired or lack access. Run `grok login` to sign in again.'],
    ['auth/manager_tests.rs:1863', 'Not logged in. Run `grok login`.'],
    ['agent/mvp_agent/agent_ops.rs:2392', "[grok] Relay sync: DISABLED (no auth - run 'grok login' first)"],
  ];

  for (const [anchor, wording] of REAL_WORDINGS) {
    it(`문다: ${anchor}`, () => {
      expect(isGrokAuthError(new Error(wording))).toBe(true);
      expect(isGrokAuthError(wording)).toBe(true);
    });
  }

  it('일반형도 문다 (문면 변경 대비)', () => {
    for (const m of ['unauthenticated', 'invalid api key', 'token expired', 'HTTP 401 from /token']) {
      expect(isGrokAuthError(new Error(m))).toBe(true);
    }
  });

  it('인증과 무관한 실패는 «안» 문다', () => {
    for (const m of [
      'ECONNREFUSED 127.0.0.1:1234',
      'turn exceeded 60000ms wall-clock — aborting',
      'session not found',
      'rate limit exceeded',      // 4xx 지만 401 이 아니다
      'model grok-build is unavailable',
    ]) {
      expect(isGrokAuthError(new Error(m))).toBe(false);
    }
  });

  it('빈 입력은 false', () => {
    expect(isGrokAuthError(null)).toBe(false);
    expect(isGrokAuthError(undefined)).toBe(false);
    expect(isGrokAuthError('')).toBe(false);
  });
});

// ── 만료 판정 ───────────────────────────────────────────────────────────────
function writeAuthJson(body: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'grok-auth-'));
  const p = join(dir, 'auth.json');
  writeFileSync(p, JSON.stringify(body), 'utf-8');
  return p;
}

const NOW = Date.parse('2026-08-13T00:00:00.000Z');
const FUTURE = '2026-09-01T00:00:00.000Z';
const PAST = '2026-07-01T00:00:00.000Z';

describe('readGrokTokenFreshness — ⛔ 최상위가 flat 이 아니다', () => {
  it('실제 형태(<issuer>::<client_id> 키)에서 expires_at 을 찾는다', () => {
    // 실측 구조: ~/.grok/auth.json 은 스코프 키 아래에 필드가 있다.
    const p = writeAuthJson({
      'https://auth.x.ai::b1a00492-0000-0000-0000-000000000000': {
        key: 'eyJ0eXAiOiJKV1Qi.PLACEHOLDER.NOT_A_REAL_TOKEN',
        auth_mode: 'oidc',
        refresh_token: 'PLACEHOLDER',
        expires_at: FUTURE,
      },
    });
    const r = readGrokTokenFreshness({ path: p, nowMs: NOW });
    expect(r).toEqual({ present: true, fresh: true, expiresAt: FUTURE, refreshable: true });
    expect(JSON.stringify(r)).not.toContain('PLACEHOLDER');
    expect(JSON.stringify(r)).not.toContain('eyJ0eXAiOiJKV1Qi');
  });

  it('flat 을 가정하면 못 찾는 자리 — 중첩이라야 잡힌다', () => {
    // 회귀 방어: 구현이 최상위에서 expires_at 을 바로 읽으면 이 케이스가 깨진다.
    const p = writeAuthJson({ scope: { expires_at: PAST } });
    expect(readGrokTokenFreshness({ path: p, nowMs: NOW }).fresh).toBe(false);
  });

  it('스코프가 여럿이면 «가장 늦은» 만료를 쓴다', () => {
    const p = writeAuthJson({
      'https://auth.x.ai::old': { expires_at: PAST },
      'https://auth.x.ai::new': { expires_at: FUTURE },
    });
    const r = readGrokTokenFreshness({ path: p, nowMs: NOW });
    expect(r.fresh).toBe(true);
    expect(r.expiresAt).toBe(FUTURE);
  });

  it('파일이 없으면 present=false · fresh=null', () => {
    const r = readGrokTokenFreshness({ path: join(tmpdir(), 'no-such-grok-auth.json'), nowMs: NOW });
    expect(r).toEqual({ present: false, fresh: null, expiresAt: null, refreshable: false });
  });

  it('⛔ 「모름」과 「만료」는 다른 값이다 — 깨진 JSON · expires_at 없음 · 파싱 불가 시각', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grok-auth-bad-'));
    const broken = join(dir, 'broken.json');
    writeFileSync(broken, '{ not json', 'utf-8');
    expect(readGrokTokenFreshness({ path: broken, nowMs: NOW })).toEqual({ present: true, fresh: null, expiresAt: null, refreshable: false });

    const noField = writeAuthJson({ 'https://auth.x.ai::x': { key: 'k' } });
    expect(readGrokTokenFreshness({ path: noField, nowMs: NOW }).fresh).toBeNull();

    const badDate = writeAuthJson({ 'https://auth.x.ai::x': { expires_at: 'not-a-date' } });
    expect(readGrokTokenFreshness({ path: badDate, nowMs: NOW }).fresh).toBeNull();

    const notObject = writeAuthJson(['array', 'not', 'object']);
    expect(readGrokTokenFreshness({ path: notObject, nowMs: NOW }).fresh).toBeNull();
  });

  it('grokAuthPath 는 <home>/.grok/auth.json', () => {
    expect(grokAuthPath('/tmp/fakehome')).toBe(join('/tmp/fakehome', '.grok', 'auth.json'));
  });

  it('만료 + refresh_token 필드 존재는 refreshable=true 이고 값을 싣지 않는다', () => {
    const secret = 'SECRET-REFRESH-MUST-NOT-LEAK';
    const p = writeAuthJson({
      'https://auth.x.ai::acct': {
        key: 'SECRET-ACCESS-MUST-NOT-LEAK',
        refresh_token: secret,
        expires_at: PAST,
      },
    });
    const r = readGrokTokenFreshness({ path: p, nowMs: NOW });
    expect(r).toEqual({ present: true, fresh: false, expiresAt: PAST, refreshable: true });
    expect(JSON.stringify(r)).not.toContain(secret);
    expect(JSON.stringify(r)).not.toContain('SECRET-ACCESS');
  });

  it('필드 없음은 false, 필드가 있으면 값이 null·빈 문자열이어도 true', () => {
    const missing = writeAuthJson({ 'https://auth.x.ai::x': { expires_at: PAST } });
    expect(readGrokTokenFreshness({ path: missing, nowMs: NOW })).toEqual({
      present: true, fresh: false, expiresAt: PAST, refreshable: false,
    });

    const empty = writeAuthJson({ 'https://auth.x.ai::x': { expires_at: PAST, refresh_token: '' } });
    expect(readGrokTokenFreshness({ path: empty, nowMs: NOW }).refreshable).toBe(true);

    const nulled = writeAuthJson({ 'https://auth.x.ai::x': { expires_at: PAST, refresh_token: null } });
    expect(readGrokTokenFreshness({ path: nulled, nowMs: NOW }).refreshable).toBe(true);
  });

  it('accountHasRefreshTokenField 는 own-property 존재만 보고 값을 읽지 않는다', () => {
    expect(accountHasRefreshTokenField({})).toBe(false);

    const inherited = Object.create({ refresh_token: 'inherited-must-not-count' });
    expect(accountHasRefreshTokenField(inherited)).toBe(false);

    const trapped: Record<string, unknown> = {};
    Object.defineProperty(trapped, 'refresh_token', {
      enumerable: true,
      configurable: true,
      get() {
        throw new Error('refresh_token value was read');
      },
    });
    expect(accountHasRefreshTokenField(trapped)).toBe(true);
  });

  it('다계정은 가장 늦은 expires_at 계정의 refresh 존재만 본다', () => {
    const p = writeAuthJson({
      'https://auth.x.ai::old-refreshable': { expires_at: PAST, refresh_token: 'PLACEHOLDER' },
      'https://auth.x.ai::new-bare': { expires_at: FUTURE },
    });
    const r = readGrokTokenFreshness({ path: p, nowMs: NOW });
    expect(r.fresh).toBe(true);
    expect(r.expiresAt).toBe(FUTURE);
    expect(r.refreshable).toBe(false);
  });
});

describe('describeGrokCredentialFreshness — 갱신 가능 만료를 재로그인과 가른다', () => {
  const CHECKED = Date.parse('2026-08-13T00:00:00.000Z');

  it('만료 + refreshable 은 expired-refreshable 이고 재로그인을 처방하지 않는다', () => {
    const snap = describeGrokCredentialFreshness(
      { present: true, fresh: false, expiresAt: PAST, refreshable: true },
      { checkedAtMs: CHECKED },
    );
    expect(snap.status).toBe('expired-refreshable');
    expect(snap.expiresAt).toBe(PAST);
    expect(snap.action).not.toContain('grok login');
    expect(snap.action).toContain('갱신');
  });

  it('만료 + 미보유는 expired 이고 재로그인을 처방한다', () => {
    const snap = describeGrokCredentialFreshness(
      { present: true, fresh: false, expiresAt: PAST, refreshable: false },
      { checkedAtMs: CHECKED },
    );
    expect(snap.status).toBe('expired');
    expect(snap.action).toContain('grok login');
  });

  it('만료 + refresh_token 필드만 있으면 값이 비어도 expired-refreshable 이다', () => {
    const empty = writeAuthJson({ 'https://auth.x.ai::x': { expires_at: PAST, refresh_token: '' } });
    const emptySnap = describeGrokCredentialFreshness(
      readGrokTokenFreshness({ path: empty, nowMs: NOW }),
      { checkedAtMs: CHECKED },
    );
    expect(emptySnap.status).toBe('expired-refreshable');
    expect(emptySnap.action).not.toContain('grok login');

    const nulled = writeAuthJson({ 'https://auth.x.ai::x': { expires_at: PAST, refresh_token: null } });
    const nullSnap = describeGrokCredentialFreshness(
      readGrokTokenFreshness({ path: nulled, nowMs: NOW }),
      { checkedAtMs: CHECKED },
    );
    expect(nullSnap.status).toBe('expired-refreshable');
    expect(nullSnap.action).not.toContain('grok login');
  });

  it('미래 만료는 fresh · 조치 없음', () => {
    const snap = describeGrokCredentialFreshness(
      { present: true, fresh: true, expiresAt: FUTURE, refreshable: true },
      { checkedAtMs: CHECKED },
    );
    expect(snap.status).toBe('fresh');
    expect(snap.action).toBe('조치 없음');
  });

  it('파일 없음·못 읽음은 unknown / lookup-failed 이지 expired 가 아니다', () => {
    const missing = describeGrokCredentialFreshness(
      { present: false, fresh: null, expiresAt: null, refreshable: false },
      { checkedAtMs: CHECKED },
    );
    expect(missing.status).toBe('unknown');
    expect(missing.status).not.toBe('expired');

    const unreadable = describeGrokCredentialFreshness(undefined, { checkedAtMs: CHECKED, lookupFailed: true });
    expect(unreadable.status).toBe('lookup-failed');
    expect(unreadable.status).not.toBe('expired');
  });

  it('reader 산출을 그대로 넘기면 중첩 만료+refresh 가 expired-refreshable 로 이어진다', () => {
    const secret = 'PIPELINE-REFRESH-MUST-NOT-LEAK';
    const p = writeAuthJson({
      'https://auth.x.ai::nested': {
        key: 'PIPELINE-ACCESS-MUST-NOT-LEAK',
        refresh_token: secret,
        expires_at: PAST,
      },
    });
    const snap = describeGrokCredentialFreshness(readGrokTokenFreshness({ path: p, nowMs: NOW }), { checkedAtMs: CHECKED });
    expect(snap.status).toBe('expired-refreshable');
    expect(snap.action).not.toMatch(/grok login/);
    expect(JSON.stringify(snap)).not.toContain(secret);
    expect(JSON.stringify(snap)).not.toContain('PIPELINE-ACCESS');
  });
});

describe('isGrokTokenExpired — 「모름」을 「만료」로 접지 않는다', () => {
  it('만료가 확실할 때만 true', () => {
    expect(isGrokTokenExpired({ present: true, fresh: false, expiresAt: PAST })).toBe(true);
    expect(isGrokTokenExpired({ present: true, fresh: false, expiresAt: PAST, refreshable: true })).toBe(true);
  });
  it('신선/모름/미존재는 전부 false', () => {
    expect(isGrokTokenExpired({ present: true, fresh: true, expiresAt: FUTURE })).toBe(false);
    expect(isGrokTokenExpired({ present: true, fresh: null, expiresAt: null })).toBe(false);
    expect(isGrokTokenExpired({ present: false, fresh: null, expiresAt: null })).toBe(false);
  });
});

// ── spawn 계약 (⛔ 실제 grok 을 «안» 띄운다) ─────────────────────────────────
interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: (sig?: string) => boolean;
}

function fakeSpawn(): { spawnImpl: typeof import('node:child_process').spawn; calls: Array<{ cmd: string; args: string[] }>; child: FakeChild } {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    killed: false,
    kill(this: { killed: boolean }): boolean { this.killed = true; return true; },
  }) as unknown as FakeChild;
  const spawnImpl = ((cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return child;
  }) as unknown as typeof import('node:child_process').spawn;
  return { spawnImpl, calls, child };
}

describe('spawnGrokLogin — 인자 선택 · 출력 전달 · 종료 매핑', () => {
  it('기본(비헤드리스)은 `grok login --oauth`', async () => {
    const { spawnImpl, calls, child } = fakeSpawn();
    const p = spawnGrokLogin({ spawnImpl, deviceAuth: false });
    queueMicrotask(() => child.emit('exit', 0));
    const r = await p;
    expect(calls).toEqual([{ cmd: 'grok', args: ['login', '--oauth'] }]);
    expect(r).toMatchObject({ ok: true, exitCode: 0, mode: 'browser' });
  });

  it('deviceAuth 면 `grok login --device-auth`', async () => {
    const { spawnImpl, calls, child } = fakeSpawn();
    const p = spawnGrokLogin({ spawnImpl, deviceAuth: true });
    queueMicrotask(() => child.emit('exit', 0));
    const r = await p;
    expect(calls[0]?.args).toEqual(['login', '--device-auth']);
    expect(r.mode).toBe('device-code');
  });

  it('⭐ device code 와 URL 이 log 콜백으로 나온다 (사용자가 봐야 한다)', async () => {
    const { spawnImpl, child } = fakeSpawn();
    const lines: string[] = [];
    const p = spawnGrokLogin({ spawnImpl, deviceAuth: true, log: (l) => lines.push(l) });
    queueMicrotask(() => {
      child.stderr.emit('data', Buffer.from('Go to https://auth.x.ai/device\n\nCode: ABCD-EFGH\n'));
      child.emit('exit', 0);
    });
    const r = await p;
    expect(lines).toEqual(['Go to https://auth.x.ai/device', 'Code: ABCD-EFGH']);
    expect(r.output).toContain('ABCD-EFGH');   // 합본에도 남는다
  });

  it('비영 종료는 ok=false', async () => {
    const { spawnImpl, child } = fakeSpawn();
    const p = spawnGrokLogin({ spawnImpl });
    queueMicrotask(() => child.emit('exit', 1));
    expect(await p).toMatchObject({ ok: false, exitCode: 1 });
  });

  it('spawn 에러는 던지지 않고 ok=false 로 접는다', async () => {
    const { spawnImpl, child } = fakeSpawn();
    const p = spawnGrokLogin({ spawnImpl });
    queueMicrotask(() => child.emit('error', new Error('ENOENT')));
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.output).toContain('ENOENT');
  });

  it('타임아웃이면 SIGTERM ⊕ ok=false', async () => {
    const { spawnImpl, child } = fakeSpawn();
    const r = await spawnGrokLogin({ spawnImpl, timeoutMs: 5 });
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBeNull();
    expect(r.output).toContain('timed out');
    expect((child as unknown as { killed: boolean }).killed).toBe(true);
  });

  it('타임아웃 뒤 늦게 온 exit 이 결과를 «덮지 않는다»', async () => {
    const { spawnImpl, child } = fakeSpawn();
    const r = await spawnGrokLogin({ spawnImpl, timeoutMs: 5 });
    child.emit('exit', 0);            // 늦은 도착
    expect(r.ok).toBe(false);         // 이미 확정된 결과가 유지된다
  });
});

describe('grokAuthHint', () => {
  it('모드에 맞는 명령을 이름으로 말한다', () => {
    expect(grokAuthHint({ deviceAuth: false })).toContain('grok login --oauth');
    expect(grokAuthHint({ deviceAuth: true })).toContain('grok login --device-auth');
  });
});
