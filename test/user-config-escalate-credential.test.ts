// ── escalate 시 provider↔credential 실배선 (2026-07-26 · 401 근본수리) ──────────
//
// ⭐ 이 파일이 존재하는 이유(PR #5488 self review must-fix): 순수 helper
// (`resolveProviderCredential`)만 테스트하면 **helper 가 옳아도 escalate 블록이 그걸 안 부르면
// 401 은 그대로**다. 그래서 여기서는 helper 를 부르지 않고 **실제 env → `buildUserConfig()` 경로**를
// 통과시켜 최종 `cfg.llm.apiKey` 를 본다. 배선을 끊으면 이 파일이 실패해야 한다.
//
// 실측 근거(2026-07-26): escalate(tier=opus)가 `provider: anthropic / claude-opus-4-8 · API key (config)`
// 로 뜬 뒤 2초 만에 401 · toolCalls 0 → self-dev 자율 완주 불가.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setElanousConfigDir, resetElanousConfigDir } from '../src/elanous-config-dir';
import { buildUserConfig } from '../src/user-config';

let root: string;
const SAVED = new Map<string, string | undefined>();

/** escalate env + provider 키 env 를 테스트가 완전히 소유한다(머신 env 누출 차단). */
function setEnv(vars: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(vars)) {
    if (!SAVED.has(k)) SAVED.set(k, process.env[k]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'escalate-cred-'));
  setElanousConfigDir(root);
  // ⚠️ 이 테스트가 보는 키들을 **먼저 전부 비운다** — 머신에 ANTHROPIC_API_KEY 가 있으면
  //    "상속 안 함"을 검증하려는 케이스가 env 폴백으로 조용히 통과해버린다(Goodhart).
  setEnv({
    ELANOUS_ESCALATE_PROVIDER: undefined,
    ELANOUS_ESCALATE_MODEL: undefined,
    ANTHROPIC_API_KEY: undefined,
    GROK_API_KEY: undefined,
    OPENAI_API_KEY: undefined,
  });
});

afterEach(() => {
  for (const [k, v] of SAVED) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  SAVED.clear();
  resetElanousConfigDir();
  rmSync(root, { recursive: true, force: true });
});

function writeConfig(llm: Record<string, unknown>): void {
  writeFileSync(join(root, 'config.json'), JSON.stringify({ llm }), 'utf-8');
}

describe('escalate 실배선 — provider 전환 시 키도 함께 해석된다', () => {
  test('⭐ 401 재현 가드 — provider 가 전환되면 base apiKey 를 config 에 싣지 않는다', () => {
    // 실측 그대로: base=openai-codex(키 보유) → escalate 로 anthropic.
    // 종전 배선(`apiKey: str(llm.apiKey)`)은 여기서 openai 키를 실어 anthropic 에 붙였다 → 401.
    writeConfig({ provider: 'openai-codex', apiKey: 'sk-proj-openai-key', model: 'gpt-5.6-terra' });
    setEnv({ ELANOUS_ESCALATE_PROVIDER: 'anthropic', ELANOUS_ESCALATE_MODEL: 'claude-opus-4-8' });

    const cfg = buildUserConfig();
    expect(cfg.llm.provider).toBe('anthropic');       // provider 는 전환된다(종전과 동일)
    expect(cfg.llm.model).toBe('claude-opus-4-8');
    expect(cfg.llm.apiKey).toBeUndefined();           // ← 틀린 키가 실리지 않는다(이게 수리의 핵심)
  });

  test('rotation(config) 에 목표 provider 키가 있으면 그걸 싣는다 — 대표 결정 (a) 1순위', () => {
    writeConfig({
      provider: 'openai-codex',
      apiKey: 'sk-proj-openai-key',
      rotation: [{ provider: 'anthropic', apiKey: 'sk-ant-from-rotation' }],
    });
    setEnv({ ELANOUS_ESCALATE_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-from-env' });

    const cfg = buildUserConfig();
    expect(cfg.llm.apiKey).toBe('sk-ant-from-rotation');   // env 가 있어도 config 우선
  });

  test('rotation 에 없으면 provider 별 env 로 폴백', () => {
    writeConfig({ provider: 'openai-codex', apiKey: 'sk-proj-openai-key' });
    setEnv({ ELANOUS_ESCALATE_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-from-env' });

    const cfg = buildUserConfig();
    expect(cfg.llm.apiKey).toBe('sk-ant-from-env');
  });

  test('전 provider 정합 — grok 으로 전환해도 anthropic 키가 새지 않는다(국소 수리 아님·결정 (b))', () => {
    writeConfig({ provider: 'anthropic', apiKey: 'sk-ant-base' });
    setEnv({ ELANOUS_ESCALATE_PROVIDER: 'grok' });
    expect(buildUserConfig().llm.apiKey).toBeUndefined();

    setEnv({ GROK_API_KEY: 'xai-live' });
    expect(buildUserConfig().llm.apiKey).toBe('xai-live');
  });

  // ⭐ must-fix(3R) — 앞 케이스들은 전부 "무엇으로든 → anthropic/grok" 방향이라, 역방향(anthropic 을
  //    **떠나는**) 전환에서 기존 키가 제거되고 목표 키가 선택되는지는 미검증이었다.
  test('★ 역방향 전환 — anthropic → openai: 기존 anthropic 키가 제거되고 목표 키가 선택된다', () => {
    writeConfig({ provider: 'anthropic', apiKey: 'sk-ant-base' });
    setEnv({ ELANOUS_ESCALATE_PROVIDER: 'openai' });
    expect(buildUserConfig().llm.apiKey).toBeUndefined();          // anthropic 키가 openai 로 안 샌다

    setEnv({ OPENAI_API_KEY: 'sk-openai-live' });
    const cfg = buildUserConfig();
    expect(cfg.llm.provider).toBe('openai');
    expect(cfg.llm.apiKey).toBe('sk-openai-live');
  });

  test('★ 역방향 전환 — anthropic → openai-codex: catalog 파생이 null 인 provider 도 오버레이로 해석된다', () => {
    // openai-codex 는 catalog 에 envKey 가 없어(OAuth 구독) 오버레이가 없으면 여기서 키를 못 찾는다.
    writeConfig({ provider: 'anthropic', apiKey: 'sk-ant-base' });
    setEnv({ ELANOUS_ESCALATE_PROVIDER: 'openai-codex', OPENAI_API_KEY: 'sk-openai-live' });

    const cfg = buildUserConfig();
    expect(cfg.llm.provider).toBe('openai-codex');
    expect(cfg.llm.apiKey).toBe('sk-openai-live');   // openai 와 키 패밀리 공유
  });

  test('무회귀 — escalate env 가 없으면 종전과 동일(base 키 그대로)', () => {
    writeConfig({ provider: 'openai-codex', apiKey: 'sk-proj-openai-key', model: 'gpt-5.6-terra' });
    const cfg = buildUserConfig();
    expect(cfg.llm.provider).toBe('openai-codex');
    expect(cfg.llm.apiKey).toBe('sk-proj-openai-key');   // 전환이 없으면 상속이 정답
    expect(cfg.llm.model).toBe('gpt-5.6-terra');
  });

  // ⭐ 리뷰 must-fix(2R) — 이 세 개가 "escalate 무관 경로의 인증 계약"을 고정한다. 앞선 버전은
  //    무조건 rotation→env→base 로 우선순위를 바꿔 **머신 env 가 config 키를 덮었고**, 테스트가
  //    env 를 비워둬서 그 회귀를 숨겼다. 여기서는 일부러 env·rotation 을 **채운 채** 검증한다.
  test('★ 무회귀 — 전환이 없으면 머신 env 가 config apiKey 를 덮지 않는다', () => {
    writeConfig({ provider: 'anthropic', apiKey: 'sk-ant-from-config' });
    setEnv({ ANTHROPIC_API_KEY: 'sk-ant-from-machine-env' });   // escalate env 는 없음

    expect(buildUserConfig().llm.apiKey).toBe('sk-ant-from-config');
  });

  test('★ 무회귀 — 전환이 없으면 rotation 이 config apiKey 를 덮지 않는다', () => {
    writeConfig({
      provider: 'anthropic',
      apiKey: 'sk-ant-from-config',
      rotation: [{ provider: 'anthropic', apiKey: 'sk-ant-from-rotation' }],
    });

    expect(buildUserConfig().llm.apiKey).toBe('sk-ant-from-config');
  });

  test('★ 무회귀 — escalate 가 같은 provider 를 명시해도 config apiKey 가 이긴다', () => {
    writeConfig({
      provider: 'anthropic',
      apiKey: 'sk-ant-from-config',
      rotation: [{ provider: 'anthropic', apiKey: 'sk-ant-from-rotation' }],
    });
    setEnv({ ELANOUS_ESCALATE_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-from-machine-env' });

    // 전환이 아니라 **모델만 승격**하는 경로 — 키 해석은 종전 그대로여야 한다.
    expect(buildUserConfig().llm.apiKey).toBe('sk-ant-from-config');
  });

  test('무회귀 — escalate 가 같은 provider 를 지정하면 base 키를 상속한다(모델만 승격하는 경로)', () => {
    writeConfig({ provider: 'anthropic', apiKey: 'sk-ant-base', model: 'claude-sonnet-5' });
    setEnv({ ELANOUS_ESCALATE_PROVIDER: 'anthropic', ELANOUS_ESCALATE_MODEL: 'claude-opus-4-8' });

    const cfg = buildUserConfig();
    expect(cfg.llm.apiKey).toBe('sk-ant-base');
    expect(cfg.llm.model).toBe('claude-opus-4-8');
  });

  // ⭐ should-fix(10R) — baseUrl 도 키와 같은 규율. 전환인데 옛 엔드포인트를 물려주면 새 키·provider 를
  //    이전 주소로 보낸다(401 과 같은 계열의 실패).
  test('★ 전환 시 옛 baseUrl 을 물려주지 않는다(커스텀 엔드포인트 오배송 차단)', () => {
    writeConfig({ provider: 'anthropic', apiKey: 'sk-ant-base', baseUrl: 'https://anthropic.internal/v1' });
    setEnv({ ELANOUS_ESCALATE_PROVIDER: 'grok', GROK_API_KEY: 'xai-live' });

    const cfg = buildUserConfig();
    expect(cfg.llm.apiKey).toBe('xai-live');
    expect(cfg.llm.baseUrl).toBeUndefined();   // grok 키를 anthropic 사설 엔드포인트로 보내지 않는다
  });

  test('★ 전환 시 rotation 에 목표 provider 의 baseUrl 이 있으면 그걸 쓴다', () => {
    writeConfig({
      provider: 'anthropic',
      apiKey: 'sk-ant-base',
      baseUrl: 'https://anthropic.internal/v1',
      rotation: [{ provider: 'grok', apiKey: 'xai-rot', baseUrl: 'https://grok.internal/v1' }],
    });
    setEnv({ ELANOUS_ESCALATE_PROVIDER: 'grok' });

    const cfg = buildUserConfig();
    expect(cfg.llm.apiKey).toBe('xai-rot');
    expect(cfg.llm.baseUrl).toBe('https://grok.internal/v1');
  });

  test('★ 무회귀 — 전환이 아니면 baseUrl 은 종전 그대로', () => {
    writeConfig({ provider: 'anthropic', apiKey: 'sk-ant-base', baseUrl: 'https://anthropic.internal/v1' });
    expect(buildUserConfig().llm.baseUrl).toBe('https://anthropic.internal/v1');

    setEnv({ ELANOUS_ESCALATE_PROVIDER: 'anthropic', ELANOUS_ESCALATE_MODEL: 'claude-opus-4-8' });
    expect(buildUserConfig().llm.baseUrl).toBe('https://anthropic.internal/v1');   // 모델만 승격
  });

  test('rotation 자체는 config 에 그대로 보존된다(전환이 rotation 을 삼키지 않는다)', () => {
    writeConfig({
      provider: 'openai-codex',
      rotation: [{ provider: 'anthropic', apiKey: 'sk-ant-rot' }, { provider: 'grok', apiKey: 'xai-rot' }],
    });
    setEnv({ ELANOUS_ESCALATE_PROVIDER: 'anthropic' });

    const cfg = buildUserConfig();
    expect(cfg.llm.rotation?.map((r) => r.provider)).toEqual(['anthropic', 'grok']);
  });
});
