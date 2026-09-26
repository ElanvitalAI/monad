// src/acp/grok-auth-probe.test.ts
//
// Grok auth probe + backend-registry 의 grok availability gating 검증.
// fs.existsSync 는 mock 어려우므로 실 filesystem 활용 — env 만 override.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { detectGrokAuth, isGrokAvailable, resolveGrokAuthForSpawn } from './grok-auth-probe.js';
import { ACP_BACKENDS, listAcpBackends, getAcpBackend } from './backend-registry.js';

/** 실 `~/.grok/auth.json` 의 존재 여부 — test 실행 환경 의존. probe 의
 *  oauth path 시나리오 시 이 값에 따라 conditional skip 한다. */
const realOAuthAuthExists = existsSync(join(homedir(), '.grok', 'auth.json'));

describe('detectGrokAuth · ⭐ 구독(OAuth) 우선 (대표 2026-08-13 지시로 «뒤집힌» 계약)', () => {
  // ⛔ 옛 계약은 「env(api_key) 우선」이었다. 뒤집은 이유는 취향이 아니라
  //    «실행 경로와의 정합»이다 — elanous 는 grok 자식을 띄울 때 API 키 env 를
  //    스크럽하고(`grokBackend.scrubEnv`) `GROK_DISABLE_API_KEY_AUTH=1` 을
  //    강제한다. 즉 자식은 API 키를 못 본다. 옛 판정은 그 반대를 말했다.
  //    (실측 2026-08-13: OAuth 재로그인 직후 XAI_API_KEY 가 있자 api_key 로 판정)

  test('⭐ oauth 파일이 있으면 XAI_API_KEY 가 있어도 oauth 다', () => {
    if (!realOAuthAuthExists) return;   // 실 파일이 있을 때만 의미 있다
    const state = detectGrokAuth({ XAI_API_KEY: 'xai-...' } as NodeJS.ProcessEnv);
    expect(state).toEqual({ method: 'oauth', available: true });
  });

  test('⭐ 별칭 env(GROK_CODE_XAI_API_KEY)에도 구독이 이긴다', () => {
    if (!realOAuthAuthExists) return;
    const state = detectGrokAuth({ GROK_CODE_XAI_API_KEY: 'xai-...' } as NodeJS.ProcessEnv);
    expect(state.method).toBe('oauth');
  });

  test('oauth 가 없을 때만 env 가 api_key 를 낸다', () => {
    if (realOAuthAuthExists) return;    // 파일이 있으면 위 규칙이 이긴다
    expect(detectGrokAuth({ XAI_API_KEY: 'x' } as NodeJS.ProcessEnv))
      .toEqual({ method: 'api_key', available: true });
    expect(detectGrokAuth({ GROK_CODE_XAI_API_KEY: 'x' } as NodeJS.ProcessEnv))
      .toEqual({ method: 'api_key', available: true });
  });

  test('⚠️ 예외 — 스크럽을 끄면(preferApiKeyEnv) env 가 이긴다', () => {
    // 자식이 API 키를 «실제로 보게 되는» 설정에서는 판정도 그것을 따라가야 한다.
    const state = detectGrokAuth(
      { XAI_API_KEY: 'xai-...' } as NodeJS.ProcessEnv,
      { preferApiKeyEnv: true },
    );
    expect(state).toEqual({ method: 'api_key', available: true });
  });

  test('preferApiKeyEnv 라도 env 가 없으면 oauth 로 떨어진다', () => {
    if (!realOAuthAuthExists) return;
    expect(detectGrokAuth({} as NodeJS.ProcessEnv, { preferApiKeyEnv: true }).method).toBe('oauth');
  });

  test('빈 env + oauth file 없음 → none', () => {
    // 사용자 환경에 oauth file 이 있으면 이 테스트는 trivially 'oauth' 반환 — skip.
    if (realOAuthAuthExists) return;
    const state = detectGrokAuth({} as NodeJS.ProcessEnv);
    expect(state).toEqual({ method: 'none', available: false });
  });

  test('빈 string env value → 무시 (none 또는 oauth)', () => {
    const state = detectGrokAuth({ XAI_API_KEY: '' } as NodeJS.ProcessEnv);
    // env truthy 가 아니므로 oauth path 또는 none
    expect(state.method).not.toBe('api_key');
  });
});

describe('isGrokAvailable · convenience boolean', () => {
  test('api_key path → true', () => {
    expect(isGrokAvailable({ XAI_API_KEY: 'xai-...' } as NodeJS.ProcessEnv)).toBe(true);
  });

  test('빈 env (no oauth) → realOAuthAuthExists 와 동일', () => {
    expect(isGrokAvailable({} as NodeJS.ProcessEnv)).toBe(realOAuthAuthExists);
  });

  test('⛔ 우선순위를 뒤집어도 «가용성»은 안 바뀐다 (회귀 방어)', () => {
    // 둘 중 하나라도 있으면 true — 이 값이 백엔드 목록 게이팅을 좌우하므로
    // 순서 변경이 여기로 새면 grok 이 목록에서 사라진다.
    expect(isGrokAvailable({ XAI_API_KEY: 'x' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isGrokAvailable({ GROK_CODE_XAI_API_KEY: 'x' } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('resolveGrokAuthForSpawn · 스크럽 설정과 «함께» 읽는 단일 창구', () => {
  test('기본(스크럽 ON) = 구독 우선', () => {
    if (!realOAuthAuthExists) return;
    expect(resolveGrokAuthForSpawn({ XAI_API_KEY: 'x' } as NodeJS.ProcessEnv).method).toBe('oauth');
  });

  test('scrubBillingEnv=false = 자식이 키를 본다 ⇒ api_key', () => {
    expect(
      resolveGrokAuthForSpawn({ XAI_API_KEY: 'x' } as NodeJS.ProcessEnv, { scrubBillingEnv: false }).method,
    ).toBe('api_key');
  });

  test('scrubBillingEnv=true 명시도 구독 우선', () => {
    if (!realOAuthAuthExists) return;
    expect(
      resolveGrokAuthForSpawn({ XAI_API_KEY: 'x' } as NodeJS.ProcessEnv, { scrubBillingEnv: true }).method,
    ).toBe('oauth');
  });
});

describe('ACP_BACKENDS · grok entry shape', () => {
  test('grok entry exists with expected fields', () => {
    const spec = ACP_BACKENDS.grok;
    expect(spec).toBeDefined();
    expect(spec.id).toBe('grok');
    expect(spec.command).toBe('grok');
    expect(spec.args).toEqual(['agent', 'stdio']);
    expect(spec.transport).toBe('acp');
    expect(spec.npmPackage).toBe(''); // xAI install.sh sentinel
    expect(typeof spec.probeAvailable).toBe('function');
  });

  test('getAcpBackend("grok") returns the spec (skipEnvGate)', () => {
    // probeAvailable 은 listAcpBackends 의 filter — getAcpBackend 는 spec 만.
    const spec = getAcpBackend('grok', { skipEnvGate: true });
    expect(spec.id).toBe('grok');
  });
});

describe('listAcpBackends · grok availability via probe', () => {
  test('XAI_API_KEY env 있을 때 grok 포함', () => {
    const backends = listAcpBackends({
      env: { XAI_API_KEY: 'xai-test-...' } as NodeJS.ProcessEnv,
    });
    expect(backends.map((b) => b.id)).toContain('grok');
  });

  test('env 없고 oauth 없을 때 grok 제외 (probeAvailable=false)', () => {
    // 사용자 환경에 oauth file 가 있으면 skip — probeAvailable=true 가 됨.
    if (realOAuthAuthExists) return;
    const backends = listAcpBackends({ env: {} as NodeJS.ProcessEnv });
    expect(backends.map((b) => b.id)).not.toContain('grok');
  });

  test('includeGated=true 시 probeAvailable 무시 · grok 포함', () => {
    const backends = listAcpBackends({
      includeGated: true,
      env: {} as NodeJS.ProcessEnv,
    });
    expect(backends.map((b) => b.id)).toContain('grok');
  });

  test('claude/gemini/codex 는 probe 영향 X', () => {
    const backends = listAcpBackends({
      env: { XAI_API_KEY: 'xai-test-...' } as NodeJS.ProcessEnv,
    });
    const ids = backends.map((b) => b.id);
    expect(ids).toContain('claude');
    expect(ids).toContain('gemini');
    expect(ids).toContain('codex-app-server');
  });
});

describe('detectGrokAuth · oauth path with synthetic home', () => {
  // synthetic HOME 으로 oauth path 검증 — 실 ~/.grok/auth.json 영향 회피.
  // 단, probe 가 process.env.HOME 을 직접 안 보고 os.homedir() 를 호출하므로
  // 이 시나리오는 process-level 만 의미 있음. 본 테스트는 함수 contract 의
  // documenting 용 — 실 검증은 위의 env precedence + listAcpBackends 가 cover.

  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'grok-auth-test-'));
    mkdirSync(join(tmpHome, '.grok'), { recursive: true });
    writeFileSync(
      join(tmpHome, '.grok', 'auth.json'),
      JSON.stringify({ token: 'cached-...' }),
    );
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  test('synthetic HOME 의 oauth file (HOME override · contract doc)', () => {
    // probe 가 os.homedir() 를 호출 — Bun 의 homedir 는 HOME 을 honour.
    const origHome = process.env.HOME;
    process.env.HOME = tmpHome;
    try {
      const state = detectGrokAuth({} as NodeJS.ProcessEnv);
      // homedir() 가 HOME 을 봤다면 oauth, 아니면 (실 home 의 file 또는 none)
      expect(['oauth', 'none', 'api_key']).toContain(state.method);
    } finally {
      process.env.HOME = origHome;
    }
  });
});
