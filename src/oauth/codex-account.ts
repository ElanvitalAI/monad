// Codex «계정» 해석 — 어느 계정의 토큰을 정본으로 쓸 것인가.
//
// ⛔⭐⭐⭐ **왜 이것이 필요한가**(2026-08-05 실측 · MANUAL-llm-provider-operations §3a):
//   `CODEX_HOME` 은 monad 의 «미러 쓰기 경로»만 바꾸고 «정본»은 `~/.monad/auth.json` 하나였다.
//   ⇒ 계정을 둘 만들어도 ***조회는 계정별로 되고 실행은 안 됐다***. 더 나쁘게는
//     `CODEX_HOME=<B> monad <LLM 명령>` 이 토큰 갱신 때 «A 의 토큰으로 B 를 덮었다».
//   ✅ 그래서 계정을 «이름»으로 두고, 이름마다 ⓐ 정본 스토어 키 ⓑ 미러 홈 을 갈라 준다.
//
// ⛔⭐⭐ **기본 계정의 동작은 «한 바이트도» 안 바뀐다** — 스토어 키는 그대로 `openai-codex` 이고
//   홈은 그대로 `CODEX_HOME || ~/.codex` 다. 마이그레이션이 필요 없다는 뜻이고, 그것이 이 설계의 조건이다.

import { homedir } from 'node:os';
import { debug } from '../debug/log.js';
import { join } from 'node:path';

/** 기본 계정의 이름. ⛔ 이 이름은 스토어 키에 «안 붙는다»(하위호환). */
export const DEFAULT_CODEX_ACCOUNT = 'default';

export interface CodexAccountResolution {
  /** 사람이 부르는 이름. */
  readonly name: string;
  /** `~/.monad/auth.json` 안의 provider 키. 기본 계정은 «접미 없음». */
  readonly storeKey: string;
  /** 공식 CLI 와 공유하는 홈(= 미러 대상). */
  readonly home: string;
  /** 이 값이 어디서 왔나 — ⛔ 「왜 이 계정인가」를 산출·로그가 말할 수 있어야 한다.
   *  ⛔ `config` 는 «없다» — 지속 설정은 이 판의 스코프가 아니고, 안 배선된 계약을 만들지 않는다(2R must-fix).
   *  ⭐ `rotated` = 사람이 고른 게 «아니라» 리밋 때문에 시스템이 넘긴 것이다(`S4`).
   *    그 구분이 없으면 표면이 「사람이 골랐다」고 거짓을 말한다. */
  readonly source: 'env' | 'default' | 'rotated';
}

/** ⛔ 이름은 스토어 키에 들어가므로 «구분자와 공백»을 막는다. */
export function isValidAccountName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name);
}

export function codexStoreKey(name: string): string {
  return name === DEFAULT_CODEX_ACCOUNT ? 'openai-codex' : `openai-codex:${name}`;
}

/** 스토어 키가 codex 계열인가 — 미러 판정에 쓴다(기본·이름 계정 «둘 다» 참). */
export function isCodexStoreKey(key: string): boolean {
  return key === 'openai-codex' || key.startsWith('openai-codex:');
}

/** 스토어 키에서 계정 이름을 되꺼낸다. */
export function accountNameFromStoreKey(key: string): string {
  return key === 'openai-codex' ? DEFAULT_CODEX_ACCOUNT : key.slice('openai-codex:'.length);
}

/**
 * 지금 어느 계정을 쓰나.
 * ⭐ 지금은 per-run env 하나뿐이다 — `MONAD_CODEX_ACCOUNT` ⊕ `MONAD_CODEX_ACCOUNT_HOME`.
 *   ⛔ 지속 설정(config)은 «이 판의 스코프가 아니다» — 안 배선된 계약을 미리 만들지 않는다.
 * ⛔ 이름이 유효하지 않거나 홈을 모르면 «기본으로 떨어진다** — 모르는 계정으로 쓰는 것보다 안전하다.
 */
export function resolveCodexAccount(
  env: NodeJS.ProcessEnv = process.env,
  /** ⛔⭐ 「이름은 골랐는데 홈을 모른다」를 «정본 기록»으로 메운다(2026-08-11 72차).
   *  📏 그 전 실물: `MONAD_CODEX_ACCOUNT=team` 만 주면 홈이 없어 ***조용히 default 로 떨어지는데***
   *    그 상태로 `explicit` 판정이 서서 ***관측이 「사람이 명시했다」고 말했다*** — 계정은 default 인데.
   *  ⛔ 여기서 스토어를 «직접 읽지 않는다» — `store.ts → codex-account.ts` 의존이라 순환이 된다.
   *    그래서 읽을 수 있는 쪽(`codex-account-store.ts`)이 이 심으로 «넣어 준다». */
  deps: { readonly storedHome?: (storeKey: string) => string | undefined } = {},
): CodexAccountResolution {
  const fromEnv = env.MONAD_CODEX_ACCOUNT?.trim();
  const picked = fromEnv && isValidAccountName(fromEnv)
    ? { name: fromEnv, source: 'env' as const }
    : { name: DEFAULT_CODEX_ACCOUNT, source: 'default' as const };

  if (picked.name === DEFAULT_CODEX_ACCOUNT) {
    // ⛔ 기본 계정만 `CODEX_HOME` 을 존중한다 — 종전 동작 그대로.
    const envHome = env.CODEX_HOME?.trim();
    return {
      name: DEFAULT_CODEX_ACCOUNT,
      storeKey: 'openai-codex',
      home: envHome && envHome.length > 0 ? envHome : join(homedir(), '.codex'),
      source: picked.source === 'env' ? 'env' : picked.source,
    };
  }

  const envHome = env.MONAD_CODEX_ACCOUNT_HOME?.trim();
  // ⭐ env 가 먼저(사람이 그 자리에서 준 것) · 없으면 정본 기록이 아는 홈.
  const storedHome = deps.storedHome?.(codexStoreKey(picked.name))?.trim();
  const home = envHome && envHome.length > 0
    ? envHome
    : storedHome && storedHome.length > 0 ? storedHome : undefined;
  if (!home) {
    // ⛔ 이름은 골랐는데 홈을 모른다 ⇒ 기본으로 떨어진다. 조용히 «다른 계정»을 쓰지 않는다.
    //   ⭐ 그리고 «조용히» 떨어지지도 않는다 — 관측을 남긴다(2R should-fix).
    debug.log('oauth.codex-account', 'named-account-home-missing', { requested: picked.name, fellBackTo: DEFAULT_CODEX_ACCOUNT, storeConsulted: deps.storedHome !== undefined }, { level: 'warn' });
    const envHome = env.CODEX_HOME?.trim();
    return {
      name: DEFAULT_CODEX_ACCOUNT,
      storeKey: 'openai-codex',
      home: envHome && envHome.length > 0 ? envHome : join(homedir(), '.codex'),
      source: 'default',
    };
  }
  return { name: picked.name, storeKey: codexStoreKey(picked.name), home, source: picked.source };
}

/** 그 계정이 «선언한» 홈의 auth 파일.
 *  ⛔⭐ 이것은 «실효» 홈이 아니다 — 실제로 미러·영속이 가는 곳은 정본 기록이 정한다.
 *  그 답은 `effectiveCodexHome()` 하나가 낸다(4R must-fix). */
export function codexAccountAuthPath(resolution: CodexAccountResolution): string {
  return join(resolution.home, 'auth.json');
}

/** 실효 홈의 출처 — ⛔ 「왜 이 홈인가」를 산출이 말할 수 있어야 한다. */
export type CodexHomeSource = 'store' | 'env' | 'default' | 'none';

export interface EffectiveCodexHome {
  /** 실제로 미러·영속이 가는 홈. ⛔ `undefined` = 「어디에도 안 간다」(모르는 곳에 토큰을 쓰지 않는다). */
  readonly home: string | undefined;
  readonly source: CodexHomeSource;
  /** env 가 «다른» 홈을 말하고 있으면 그 값 — 표면이 그 불일치를 감추면 안 된다. */
  readonly declaredHome?: string;
}

/**
 * ⛔⭐⭐⭐ **이 계정이 실제로 쓰는 홈은 어디인가** — 이 함수 «하나»가 답한다(4R must-fix).
 *
 * 종전엔 두 자리가 각자 답했다: 미러/영속은 «정본 기록»(state.codexHome)을 보고,
 * `account list` 의 「홈」 줄과 `codexAccountAuthPath()` 는 «env 해석»을 봤다.
 * ⇒ 둘이 갈리면 ***CLI 가 거짓 상태를 보고한다*** — 사용자가 준 홈과 다른 홈이 실제로 쓰인다.
 * ⛔ 판정층(표면)이 피판정층과 «다른 자»를 쓰면 안 된다.
 *
 * ⭐ 우선순위는 «런타임이 이미 하던 그대로»다 — 이 함수는 규칙을 바꾸지 않고 «한 자리로 모은다».
 */
export function effectiveCodexHome(
  account: CodexAccountResolution,
  stored: { codexHome?: string } | null,
  /** ⛔ 출처 판정은 «그 해석을 만든 env»로 한다(5R should-fix). 전역 `process.env` 를 몰래 읽으면
   *  `activeCodexAccountView(customEnv)` 가 «거짓 출처»를 낸다 — 4R 에서 내가 심은 결손이다. */
  env: NodeJS.ProcessEnv = process.env,
): EffectiveCodexHome {
  const declared = account.home;
  if (stored?.codexHome) {
    return {
      home: stored.codexHome,
      source: 'store',
      // ⛔ env 가 «다른» 곳을 가리키면 그 사실을 값으로 남긴다 — 표면이 조용히 덮으면 안 된다.
      ...(declared && declared !== stored.codexHome ? { declaredHome: declared } : {}),
    };
  }
  if (account.storeKey === 'openai-codex') {
    return { home: declared, source: env.CODEX_HOME?.trim() ? 'env' : 'default' };
  }
  // ⛔ 이름 계정인데 정본이 그 홈을 모른다 ⇒ 어느 미러도 안 쓴다(1R·2R 에서 세운 불변식).
  return { home: undefined, source: 'none', ...(declared ? { declaredHome: declared } : {}) };
}
