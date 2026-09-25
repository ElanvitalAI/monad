// Grok CLI · OAuth/API key state detection.
//
// xAI 의 공식 Grok Build CLI (sha 8b63e9068c · 0.1.210+) 가 ACP standard
// transport (stdio JSON-RPC 2.0) 를 지원한다. monad-agent 의 backend-
// registry 는 단일 `requiresEnv` 만으로 gating 가능한데, grok 의 auth
// 는 두 source 중 하나 충족: (1) `XAI_API_KEY` / `GROK_CODE_XAI_API_KEY`
// env, (2) `~/.grok/auth.json` (browser OAuth via `grok login`). 본 모듈
// 이 둘 다 detect 해서 listAcpBackends() 의 grok 항목 availability 를
// 결정한다.
//
// Sync 의도적 — listAcpBackends 가 sync · fs.existsSync 사용. probe 결과
// 는 process lifetime 동안 cache 안 함 (사용자가 mid-session 에 grok
// login 가능 · listAcpBackends 가 매번 호출되면 다음 호출이 즉시 반영).
//
// 참고: codex-auth.ts 의 패턴과 유사 — binary 가 OAuth 의 owner ·
// monad-agent 는 state detect 만.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type GrokAuthMethod = 'api_key' | 'oauth' | 'none';

export interface GrokAuthState {
  method: GrokAuthMethod;
  available: boolean;
}

/** API-key env selected by Grok's documented precedence. The name is safe
 * to expose for observability; callers must never emit the value. */
export function grokApiKeyEnvName(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.XAI_API_KEY) return 'XAI_API_KEY';
  if (env.GROK_CODE_XAI_API_KEY) return 'GROK_CODE_XAI_API_KEY';
  return null;
}

/** Detect grok auth state from env + filesystem.
 *
 *  ⭐⭐ **구독(OAuth)이 API 키보다 «먼저»다** (대표 지시 2026-08-13).
 *
 *  ⛔ 이 순서는 취향이 아니라 **실제 동작과의 정합**이다. monad 는 grok 자식을
 *  띄울 때 API 키 env 를 **스크럽하고** 구독을 강제한다:
 *    · `grokBackend.scrubEnv = ['XAI_API_KEY','GROK_API_KEY','GROK_CODE_XAI_API_KEY']`
 *      (`src/agent-mission/driver.ts`)
 *    · `GROK_DISABLE_API_KEY_AUTH: '1'` 강제 (driver.ts ⊕ client.ts `scrubAcpBillingEnv`)
 *  ⇒ **자식은 API 키를 «보지 못한다».** 그런데 예전 순서는 부모 env 를 먼저 보고
 *  `api_key` 라 답했다 — 즉 판정이 실행 경로와 «반대»를 말하고 있었다.
 *  (2026-08-13 실측: OAuth 로 갓 로그인한 상태에서 `XAI_API_KEY` 가 설정돼 있자
 *   `detectGrokAuth()` 가 `api_key` 를 냈다.)
 *
 *  Order of precedence:
 *  1. `~/.grok/auth.json` (구독 OAuth · `grok login` 이 쓴다) → `'oauth'`
 *  2. `XAI_API_KEY` env → `'api_key'`
 *  3. `GROK_CODE_XAI_API_KEY` env (grok-cli 내부 별칭) → `'api_key'`
 *
 *  ⚠️ **예외 하나** — 사용자가 스크럽을 «끄면**(`acp.scrubBillingEnv === false`)
 *  자식이 API 키를 실제로 보게 되므로, 그때는 env 가 이긴다. 판정은 언제나
 *  「자식이 무엇을 쓰게 되는가」를 따라간다. 호출자가 그 config 를 읽어
 *  `preferApiKeyEnv` 로 넘긴다(기본 false = 스크럽 ON = 구독 우선).
 *
 *  ⛔ 만료는 여기서 «안» 본다 — `expires_at` 이 지났어도 refresh_token 이 살아
 *  있으면 grok 바이너리가 조용히 갱신한다(바이너리가 refresh 의 소유자다).
 *  만료를 가용성으로 접으면 멀쩡한 구독을 «없음»으로 판정한다. 만료 판정이
 *  필요하면 `grok-auth.ts` 의 `readGrokTokenFreshness()` 를 쓴다. */
export function detectGrokAuth(
  env: NodeJS.ProcessEnv = process.env,
  opts: { preferApiKeyEnv?: boolean } = {},
): GrokAuthState {
  const authPath = join(homedir(), '.grok', 'auth.json');
  const hasOauth = existsSync(authPath);
  const apiKeyEnv = grokApiKeyEnvName(env);

  if (opts.preferApiKeyEnv === true) {
    if (apiKeyEnv) return { method: 'api_key', available: true };
    if (hasOauth) return { method: 'oauth', available: true };
    return { method: 'none', available: false };
  }

  if (hasOauth) return { method: 'oauth', available: true };
  if (apiKeyEnv) return { method: 'api_key', available: true };
  return { method: 'none', available: false };
}

/** Convenience boolean — `listAcpBackends()` 의 `probeAvailable` field
 *  에 직접 wire 가능.
 *
 *  ⚠️ **가용성은 순서와 무관하다** — 둘 중 «하나라도» 있으면 true 다. 위 순서
 *  변경은 `method` 만 바꾸고 이 값은 안 바꾼다(회귀 없음 · 테스트가 이걸 문다). */
export function isGrokAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return detectGrokAuth(env).available;
}

/** 실행 경로가 실제로 쓸 인증 방식.
 *
 *  ⭐ `detectGrokAuth` 를 «스크럽 설정과 함께» 읽는 단일 창구다. 호출자가
 *  config 읽는 것을 잊어 판정이 다시 어긋나는 것을 막는다. */
export function resolveGrokAuthForSpawn(
  env: NodeJS.ProcessEnv = process.env,
  opts: { scrubBillingEnv?: boolean } = {},
): GrokAuthState {
  // 스크럽이 켜져 있으면(기본) 자식은 API 키를 못 본다 ⇒ 구독 우선.
  const scrub = opts.scrubBillingEnv !== false;
  return detectGrokAuth(env, { preferApiKeyEnv: !scrub });
}
