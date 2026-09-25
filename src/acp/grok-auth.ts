// Grok (xAI Build CLI) · OAuth 구독 로그인 위임.
//
// ⛔ **OAuth 를 여기서 «구현하지 않는다».** `grok` 바이너리가 전 플로우를
// 이미 소유한다 — OAuth 2.1 Authorization Code + PKCE · 루프백 콜백 서버 ·
// device-code 폴백 · id_token JWKS 검증 · refresh. monad 는 codex-auth.ts
// 와 같은 자리에 선다: **감지 → 위임 → 1회 재시도**.
//
// 참조 (위임 «대상» 구현 · `ref/grok-build` rev 5d08d7e4123092567ccd584cd9f99afa2972065c):
//   crates/codegen/xai-grok-shell/src/auth/oidc/protocol.rs — PKCE · discovery · 토큰 교환 · JWT 검증
//   crates/codegen/xai-grok-shell/src/auth/oidc/login.rs    — 루프백 콜백 서버(127.0.0.1:동적) · 10분 타임아웃
//   crates/codegen/xai-grok-shell/src/auth/device_code.rs   — headless device-code 플로우
//   crates/codegen/xai-grok-shell/src/auth/config.rs:279    — client_id (obfstr 난독화 · 벤더 소유)
//
// ⭐ 공식 승인 경로다 — xAI 가 `https://x.ai/news/grok-opencode` 에서
// *"Use your SuperGrok or X Premium subscription inside OpenCode"* 로
// 서드파티 하니스의 구독 OAuth 를 안내한다(브라우저 / headless 둘 다).
//
// ⛔ monad 표면은 «의도적으로 얇다**: keyring 을 안 만지고 · OAuth 토큰을
// 안 파싱하고 · refresh 를 안 구현한다. 바이너리가 단일 진실 원천이다.
//
// ⚠️ codex 와 «다른» 점 하나 — **grok 에는 `login status` 서브커맨드가 없다**
// (`grok login --help` 실측: `--oauth` · `--device-auth` · `--debug` ·
// `--debug-file` · `--leader-socket` 뿐). 그래서 사전 점검은 서브프로세스가
// 아니라 `~/.grok/auth.json` 의 **`expires_at` 필드**를 읽는다 — 더 싸고,
// 토큰 파싱이 아니라 CLI 가 스스로 쓴 «메타데이터» 읽기다.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { debug } from '../debug/log.js';
import { isHeadlessEnv } from './codex-auth.js';

/** `grok login` 이 브라우저 플로우를 끝낼 때까지 기다리는 상한.
 *  ref/grok-build `oidc/login.rs` 의 `AUTH_CALLBACK_TIMEOUT` 이 10분이라
 *  거기에 여유를 붙였다 — 우리가 먼저 자르면 바이너리의 자체 타임아웃
 *  메시지("Login timed out after 10 minutes")를 사용자가 못 본다. */
const DEFAULT_LOGIN_TIMEOUT_MS = 11 * 60_000;

/** grok 이 인증 실패를 사용자에게 알릴 때 쓰는 문면들. ⛔ 추측이 아니라
 *  `ref/grok-build` 실측 앵커다:
 *    util/grok_auth_credentials.rs:71 "Your auth token is invalid or expired. Run `grok login` to re-authenticate."
 *    agent/relay.rs:172               "Authentication required. Run `grok login` to re-authenticate."
 *    managed_config/response.rs:45    "Your team sign-in was rejected. … Run `grok login` to sign in again."
 *    auth/manager_tests.rs:1863       "Not logged in. Run `grok login`."
 *    agent/mvp_agent/agent_ops.rs:2392 "(no auth - run 'grok login' first)"
 *
 *  ⭐ 다섯 문면이 «전부» `grok login` 을 이름으로 부른다 ⇒ 그게 가장 안정적인
 *  앵커다. 나머지는 문면이 바뀌어도 걸리도록 둔 일반형이고, 휴리스틱이므로
 *  오탐 비용은 «재시도 1회»뿐이다(codex 와 동일한 계약). */
const GROK_AUTH_ERROR_PATTERNS: readonly RegExp[] = [
  // 가장 안정적 — 다섯 실측 문면 전부가 이 형태를 담는다(따옴표/백틱 무관).
  /run\s+["'`]?grok\s+login/i,
  /not\s+logged\s+in/i,
  /auth(?:entication)?\s+required/i,
  /auth\s+token\s+is\s+invalid\s+or\s+expired/i,
  /sign-?in\s+was\s+rejected/i,
  /no\s+auth\b/i,
  // 일반형 (문면 변경 대비)
  /unauthenticated/i,
  /invalid\s+(?:api\s+key|token|credentials)/i,
  /token\s+expired/i,
  /\b401\b/,
];

export function isGrokAuthError(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  return GROK_AUTH_ERROR_PATTERNS.some((re) => re.test(msg));
}

/** `~/.grok/auth.json` 경로. 테스트가 덮을 수 있게 인자로 뺐다. */
export function grokAuthPath(home: string = homedir()): string {
  return join(home, '.grok', 'auth.json');
}

export interface GrokTokenFreshness {
  /** 파일이 있고 파싱됐나. */
  present: boolean;
  /** `expires_at` 이 미래인가. 필드가 없으면 `null`(모름 — «만료»로 읽지 마라). */
  fresh: boolean | null;
  /** 만료 시각(ISO). 없으면 null. */
  expiresAt: string | null;
  /** 선정된 계정에 `refresh_token` own property 가 있나. 값은 안 읽는다. */
  refreshable?: boolean;
}

/** 자식 발사 전 관측에 쓰는, 토큰 값 없는 신선도 상태. */
export type GrokCredentialFreshnessStatus = 'fresh' | 'expired' | 'expired-refreshable' | 'unknown' | 'lookup-failed';

export interface GrokCredentialFreshnessSnapshot {
  status: GrokCredentialFreshnessStatus;
  checkedAt: string;
  expiresAt: string | null;
  /** 사람이 취할 다음 조치. 상태 관측일 뿐 로그인·갱신을 실행하지 않는다. */
  action: string;
}

/** 기존 reader의 삼값 계약을 자식 발사 관측용 이름 있는 상태로 보존한다. */
export function describeGrokCredentialFreshness(
  freshness: GrokTokenFreshness | undefined,
  opts: { checkedAtMs?: number; lookupFailed?: boolean } = {},
): GrokCredentialFreshnessSnapshot {
  const checkedAt = new Date(opts.checkedAtMs ?? Date.now()).toISOString();
  if (opts.lookupFailed) {
    return { status: 'lookup-failed', checkedAt, expiresAt: null, action: 'Grok 자격 신선도를 읽지 못했습니다; 필요하면 `grok login` 상태를 확인한 뒤 재시도' };
  }
  if (freshness?.fresh === true) {
    return { status: 'fresh', checkedAt, expiresAt: freshness.expiresAt, action: '조치 없음' };
  }
  if (freshness?.present && freshness.fresh === false) {
    if (freshness.refreshable === true) {
      return {
        status: 'expired-refreshable',
        checkedAt,
        expiresAt: freshness.expiresAt,
        action: 'Grok 자격이 만료됐지만 갱신 가능합니다; grok 바이너리가 갱신을 시도하며 재로그인은 필요 없습니다',
      };
    }
    return { status: 'expired', checkedAt, expiresAt: freshness.expiresAt, action: 'Grok 자격이 만료됐습니다; 터미널에서 `grok login` 후 재시도' };
  }
  return { status: 'unknown', checkedAt, expiresAt: freshness?.expiresAt ?? null, action: 'Grok 자격 신선도를 확인할 수 없습니다; 런은 계속하며 필요하면 `grok login` 상태를 확인' };
}

/** 계정 객체에 `refresh_token` own property 가 있나.
 *  ⛔ 값을 읽거나 변수에 담거나 반환·로그하지 않는다 — 존재만 본다. */
export function accountHasRefreshTokenField(scope: object): boolean {
  return Object.hasOwn(scope, 'refresh_token');
}

/** `~/.grok/auth.json` 의 만료 메타데이터를 읽는다.
 *
 *  ⛔ **토큰 값을 절대 읽거나 반환하지 않는다** — 이 함수가 보는 것은 `expires_at`
 *  문자열과, 같은 계정에 `refresh_token` own property 가 있나 여부뿐이다.
 *  파일 최상위는 `"<issuer>::<client_id>"` 로 키가 잡히고
 *  (다계정 대응) 그 아래에 `key` · `refresh_token` · `expires_at` 이 있다.
 *  ⇒ **flat 을 가정하면 안 된다.** 값들을 훑어 가장 늦은 `expires_at` 을 쓴다.
 *
 *  ⚠️ `fresh: null` 은 «모른다»이지 «만료»가 아니다 — 호출자가 그 둘을
 *  같은 값으로 접으면 로그인 안 해도 되는 사용자를 로그인시킨다. */
export function readGrokTokenFreshness(
  opts: { path?: string; nowMs?: number } = {},
): GrokTokenFreshness {
  const path = opts.path ?? grokAuthPath();
  if (!existsSync(path)) {
    return { present: false, fresh: null, expiresAt: null, refreshable: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
  } catch {
    // 파일은 있는데 못 읽는다 = 「모름」. 만료로 단정하지 않는다.
    return { present: true, fresh: null, expiresAt: null, refreshable: false };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { present: true, fresh: null, expiresAt: null, refreshable: false };
  }

  let latestMs: number | null = null;
  let latestIso: string | null = null;
  let latestRefreshable = false;
  for (const scope of Object.values(parsed as Record<string, unknown>)) {
    if (!scope || typeof scope !== 'object') continue;
    const account = scope as Record<string, unknown>;
    const raw = account['expires_at'];
    if (typeof raw !== 'string') continue;
    const ms = Date.parse(raw);
    if (Number.isNaN(ms)) continue;
    if (latestMs === null || ms > latestMs) {
      latestMs = ms;
      latestIso = raw;
      latestRefreshable = accountHasRefreshTokenField(account);
    }
  }

  if (latestMs === null) {
    return { present: true, fresh: null, expiresAt: null, refreshable: false };
  }
  const now = opts.nowMs ?? Date.now();
  return { present: true, fresh: latestMs > now, expiresAt: latestIso, refreshable: latestRefreshable };
}

export type GrokLoginMode = 'browser' | 'device-code';

export interface GrokLoginResult {
  ok: boolean;
  exitCode: number | null;
  mode: GrokLoginMode;
  /** stdout+stderr 합본. ⛔ device-code 플로우의 «코드와 URL» 이 여기 실려
   *  나오므로 호출자가 사용자에게 보여야 한다. 토큰은 여기 안 실린다. */
  output: string;
}

export interface SpawnGrokLoginOpts {
  /** 기본 `grok` (PATH 해석). xAI install.sh 는 `~/.grok/bin/grok` 에 깐다. */
  grokPath?: string;
  /** 강제 device-code. 생략하면 `isHeadlessEnv()` 로 판정. */
  deviceAuth?: boolean;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  /** 진행 문면 스트리밍 — device-code 의 코드/URL 노출 경로. */
  log?: (line: string) => void;
  spawnImpl?: typeof spawn;
}

/** `grok login` 을 blocking subprocess 로 띄운다.
 *
 *  ⭐ 모드 둘은 xAI 가 공식 안내하는 그대로다 —
 *  브라우저(`--oauth`) / headless·원격(`--device-auth`).
 *  `grok login --help` 실측으로 두 플래그의 존재를 확인했다. */
export async function spawnGrokLogin(
  opts: SpawnGrokLoginOpts = {},
): Promise<GrokLoginResult> {
  const grokPath = opts.grokPath ?? 'grok';
  const useDeviceAuth = opts.deviceAuth ?? isHeadlessEnv(opts.env);
  const args = useDeviceAuth ? ['login', '--device-auth'] : ['login', '--oauth'];
  const mode: GrokLoginMode = useDeviceAuth ? 'device-code' : 'browser';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
  const spawnFn = opts.spawnImpl ?? spawn;

  debug.log('acp.grok.login', 'start', { grokPath, mode, args });

  return new Promise<GrokLoginResult>((resolve) => {
    let settled = false;
    const parts: string[] = [];

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnFn(grokPath, args, {
        env: opts.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }) as unknown as ChildProcessWithoutNullStreams;
    } catch (err) {
      debug.log('acp.grok.login', 'spawn-throw', { message: (err as Error)?.message }, { level: 'error' });
      return resolve({ ok: false, exitCode: null, mode, output: `[spawn error: ${(err as Error).message}]` });
    }

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGTERM'); } catch { /* best-effort */ }
      debug.log('acp.grok.login', 'timeout', { mode, timeoutMs }, { level: 'warn' });
      resolve({ ok: false, exitCode: null, mode, output: `${parts.join('')}\n[grok login timed out]` });
    }, timeoutMs);

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString('utf-8');
      parts.push(text);
      if (opts.log) {
        for (const line of text.split('\n')) {
          if (line.trim().length > 0) opts.log(line);
        }
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      debug.log('acp.grok.login', 'spawn-error', { mode, message: (err as Error)?.message }, { level: 'error' });
      resolve({ ok: false, exitCode: null, mode, output: `${parts.join('')}\n[spawn error: ${err.message}]` });
    });

    child.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      debug.log('acp.grok.login', 'exit', { mode, code });
      resolve({ ok: code === 0, exitCode: code, mode, output: parts.join('') });
    });
  });
}

/** 인증 만료가 «확실할» 때만 true.
 *
 *  ⛔ `fresh === null`(모름)은 false 를 낸다 — 「모름」과 「만료」를 다른 값으로
 *  두는 것이 이 저장소의 불변식이다(`「0」과 「못 셌음」을 다른 값으로`).
 *  파일이 아예 없으면 만료가 아니라 **미로그인**이고, 그건 `detectGrokAuth`
 *  의 `'none'` 이 이미 답한다. */
export function isGrokTokenExpired(freshness: GrokTokenFreshness): boolean {
  return freshness.present && freshness.fresh === false;
}

/** 사용자에게 붙일 실행 가능한 힌트 한 줄. 호출자가 원 에러 뒤에 잇는다. */
export function grokAuthHint(opts: { deviceAuth?: boolean; env?: NodeJS.ProcessEnv } = {}): string {
  const device = opts.deviceAuth ?? isHeadlessEnv(opts.env);
  return device
    ? 'grok 인증 만료 — 터미널에서 `grok login --device-auth` (원격/헤드리스) 후 재시도'
    : 'grok 인증 만료 — 터미널에서 `grok login --oauth` 후 재시도';
}
