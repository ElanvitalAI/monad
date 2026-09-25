import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { lookupLlmTierSpec } from './model-tier/llm-tier-map.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  __resetRetiredConfigKeysObservationForTests,
  buildUserConfig,
  findRetiredConfigKeys,
  inferRuntimeLlmModelFamily,
  isNativeStructureEnabledForProvider,
  isRuntimeLlmModelCompatibleWithProvider,
  resolveRoleModel,
  saveUserConfig,
} from './user-config.js';
import { debug } from './debug/log.js';

let root: string;
let configPath: string;
let priorReviewModel: string | undefined;
const savedEnv = new Map<string, string | undefined>();

function writeConfig(value: unknown): void {
  writeFileSync(configPath, JSON.stringify(value));
}

function setProcessEnv(vars: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(vars)) {
    if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function resolveAutoRoleTier(defaultProvider: 'anthropic' | 'grok'): { model: string; source: string } {
  const script = `
    import { buildUserConfig, resolveRoleModel } from ${JSON.stringify(new URL('./user-config.js', import.meta.url).href)};
    const config = buildUserConfig(${JSON.stringify(configPath)});
    config.llm.provider = 'auto';
    console.log(JSON.stringify(resolveRoleModel('review', config)));
  `;
  const child = Bun.spawnSync({
    cmd: [process.execPath, '-e', script],
    env: {
      ...process.env,
      // ⛔ 기계의 실제 로그인(codex 구독 등)을 읽지 않게 막는다 — 09-24 결정(auto = codex 우선) 뒤로
      //   이 자식은 «이 기계에 codex 로그인이 있나»에 따라 답이 갈렸다(시험이 지키는 것은 그게 아니다).
      HOME: root,
      XDG_CONFIG_HOME: join(root, 'xdg'),
      CODEX_HOME: join(root, 'codex'),
      DEFAULT_LLM_PROVIDER: defaultProvider,
      ANTHROPIC_API_KEY: defaultProvider === 'anthropic' ? 'test-anthropic-key' : '',
      XAI_API_KEY: defaultProvider === 'grok' ? 'test-grok-key' : '',
      GROK_API_KEY: '',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(child.exitCode).toBe(0);
  return JSON.parse(new TextDecoder().decode(child.stdout)) as { model: string; source: string };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'role-model-tier-'));
  configPath = join(root, 'config.json');
  priorReviewModel = process.env.MONAD_PR_REVIEW_MODEL;
  delete process.env.MONAD_PR_REVIEW_MODEL;
  setProcessEnv({
    MONAD_LLM_PROVIDER: undefined,
    MONAD_LLM_MODEL: undefined,
    MONAD_ESCALATE_PROVIDER: undefined,
    MONAD_ESCALATE_MODEL: undefined,
  });
});

afterEach(() => {
  if (priorReviewModel === undefined) delete process.env.MONAD_PR_REVIEW_MODEL;
  else process.env.MONAD_PR_REVIEW_MODEL = priorReviewModel;
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
  rmSync(root, { recursive: true, force: true });
});

describe('role model tiers', () => {
  test('resolves a configured role tier through each active provider ladder', () => {
    writeConfig({ llm: { provider: 'grok' }, roleModelTiers: { review: 'best' } });
    const grok = resolveRoleModel('review', buildUserConfig(configPath));

    writeConfig({ llm: { provider: 'anthropic' }, roleModelTiers: { review: 'best' } });
    const anthropic = resolveRoleModel('review', buildUserConfig(configPath));

    expect(grok).toEqual({ model: 'grok-4.7', source: 'tier' });
    expect(anthropic).toEqual({ model: lookupLlmTierSpec('anthropic', 'best').model, source: 'tier' });
    expect(grok.model).not.toBe(anthropic.model);
  });

  test('resolves auto through the active provider while retaining the selected tier', () => {
    writeConfig({ roleModelTiers: { review: 'best' } });

    expect(resolveAutoRoleTier('anthropic')).toEqual({ model: 'claude-opus-5-5', source: 'tier' });
    expect(resolveAutoRoleTier('grok')).toEqual({ model: 'grok-4.7', source: 'tier' });
  });

  test('a direct role model remains more specific than a configured tier', () => {
    writeConfig({
      llm: { provider: 'grok' },
      roleModels: { review: 'direct-review-model' },
      roleModelTiers: { review: 'best' },
    });

    expect(resolveRoleModel('review', buildUserConfig(configPath))).toEqual({
      model: 'direct-review-model',
      source: 'config',
    });
  });

  test('invalid role tiers are dropped and absent tiers preserve environment then default fallback', () => {
    writeConfig({ llm: { provider: 'grok' }, roleModelTiers: { review: 'ultra' } });
    const withoutTier = buildUserConfig(configPath);
    expect(withoutTier.roleModelTiers).toBeUndefined();

    process.env.MONAD_PR_REVIEW_MODEL = 'environment-review-model';
    expect(resolveRoleModel('review', withoutTier)).toEqual({
      model: 'environment-review-model',
      source: 'environment',
    });

    delete process.env.MONAD_PR_REVIEW_MODEL;
    // ⭐ 기본값도 «활성 provider 의 티어»로 푼다 — 모델 이름을 박지 않는다(대표 2026-08-18).
    //    review 의 기본 티어는 loaded 이고, grok 의 loaded 는 grok-4.7 이다(2026-09-22 승격).
    expect(resolveRoleModel('review', withoutTier)).toEqual({
      model: 'grok-4.7',
      source: 'default',
    });
  });

  test('the default (no tier · no env) still follows the active provider', () => {
    // ⛔ 회귀 가드 — 예전에는 기본값이 'gpt-5.6-sol' 로 «박혀» 있어 provider 를 바꿔도
    //    따라오지 않았다. 같은 역할·같은 경로가 provider 에 따라 «갈려야» 한다.
    delete process.env.MONAD_PR_REVIEW_MODEL;

    writeConfig({ llm: { provider: 'grok' } });
    const onGrok = resolveRoleModel('review', buildUserConfig(configPath));

    writeConfig({ llm: { provider: 'openai-codex' } });
    const onCodex = resolveRoleModel('review', buildUserConfig(configPath));

    // ⛔⭐ 모델 «판 번호»를 박지 않는다 — 이 줄의 앞 판은 `'gpt-5.6-sol'` 을 박았고
    //   2026-09-09 에 codex 최상단이 `gpt-6-astra` 로 올라가자 «조용히» 빨개져
    //   그 파일을 건드리는 «무관한» 골들이 남의 빨강을 물려받았다(🅣 150차 실측).
    //   ⇒ 이 시험이 «지키려는 것»은 판 번호가 아니라 ***「기본값이 provider 를 따라오는가」***다.
    //     그래서 「provider 가문에 속하나」로 잰다 — 모델이 올라가도 안 늙고, 회귀는 그대로 문다.
    expect(onGrok.source).toBe('default');
    expect(onCodex.source).toBe('default');
    expect(onGrok.model).toMatch(/^grok-/);
    expect(onCodex.model).toMatch(/^gpt-/);
    expect(onGrok.model).not.toBe(onCodex.model);
  });
});

describe('llm.reviewFallbackModels persistence', () => {
  test('preserves string entries through parse, save, and reload without changing fallbackChain', () => {
    writeConfig({
      llm: {
        provider: 'grok',
        fallbackChain: ['codex-rotate', 'grok'],
        reviewFallbackModels: ['grok', 7, 'grok-fast'],
      },
    });

    const config = buildUserConfig(configPath);
    expect(config.llm.reviewFallbackModels).toEqual(['grok', 'grok-fast']);
    expect(config.llm.fallbackChain).toEqual(['codex-rotate', 'grok']);

    const savedPath = join(root, 'saved-config.json');
    saveUserConfig(config, savedPath);
    const reloaded = buildUserConfig(savedPath);
    expect(reloaded.llm.reviewFallbackModels).toEqual(['grok', 'grok-fast']);
    expect(reloaded.llm.fallbackChain).toEqual(['codex-rotate', 'grok']);
  });
});

describe('tools.nativeStructure provider list', () => {
  function captureStderr(run: () => void): string {
    const chunks: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return (original as (c: string | Uint8Array, ...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stderr.write;
    try {
      run();
    } finally {
      process.stderr.write = original;
    }
    return chunks.join('');
  }

  test('listed providers apply and unlisted providers do not', () => {
    writeConfig({
      tools: { nativeStructure: { enabled: true, providers: ['grok'] } },
    });
    const native = buildUserConfig(configPath).tools.nativeStructure;
    expect(native.enabled).toBe(true);
    expect(native.providers).toEqual(['grok']);
    expect(isNativeStructureEnabledForProvider(native, 'grok')).toBe(true);
    expect(isNativeStructureEnabledForProvider(native, 'anthropic')).toBe(false);
  });

  test('absent list keeps the historical all-provider meaning when enabled', () => {
    writeConfig({ tools: { nativeStructure: { enabled: true } } });
    const native = buildUserConfig(configPath).tools.nativeStructure;
    expect(native.enabled).toBe(true);
    expect(native.providers).toBeUndefined();
    expect(isNativeStructureEnabledForProvider(native, 'grok')).toBe(true);
    expect(isNativeStructureEnabledForProvider(native, 'anthropic')).toBe(true);
    expect(isNativeStructureEnabledForProvider(native, 'openai-codex')).toBe(true);
  });

  test('disabled wins over any provider list', () => {
    writeConfig({
      tools: { nativeStructure: { enabled: false, providers: ['grok', 'anthropic'] } },
    });
    const native = buildUserConfig(configPath).tools.nativeStructure;
    expect(native.enabled).toBe(false);
    expect(native.providers).toEqual(['grok', 'anthropic']);
    expect(isNativeStructureEnabledForProvider(native, 'grok')).toBe(false);
    expect(isNativeStructureEnabledForProvider(native, 'anthropic')).toBe(false);
  });

  test('default remains disabled with no provider list', () => {
    const native = buildUserConfig(configPath).tools.nativeStructure;
    expect(native.enabled).toBe(false);
    expect(native.providers).toBeUndefined();
    expect(isNativeStructureEnabledForProvider(native, 'grok')).toBe(false);
  });

  test('malformed list falls back to no list and is observed on stderr', () => {
    writeConfig({
      tools: { nativeStructure: { enabled: true, providers: 'grok' } },
    });
    let native;
    const observed = captureStderr(() => {
      native = buildUserConfig(configPath).tools.nativeStructure;
    });
    expect(native!.enabled).toBe(true);
    expect(native!.providers).toBeUndefined();
    expect(isNativeStructureEnabledForProvider(native!, 'grok')).toBe(true);
    expect(isNativeStructureEnabledForProvider(native!, 'anthropic')).toBe(true);
    expect(observed).toContain('[user-config] tools.nativeStructure.providers');
    expect(observed).toContain('기본값');
  });

  test('list with a non-string entry is malformed and falls back', () => {
    writeConfig({
      tools: { nativeStructure: { enabled: true, providers: ['grok', 1] } },
    });
    let native;
    const observed = captureStderr(() => {
      native = buildUserConfig(configPath).tools.nativeStructure;
    });
    expect(native!.providers).toBeUndefined();
    expect(isNativeStructureEnabledForProvider(native!, 'grok')).toBe(true);
    expect(observed).toContain('[user-config] tools.nativeStructure.providers');
  });

  test('preserves an explicit goal-author persistent-grounding boolean and omits absent or malformed values', () => {
    writeConfig({ tools: { selfImplement: { goalAuthorPersistentGrounding: false } } });
    expect(buildUserConfig(configPath).tools.selfImplement.goalAuthorPersistentGrounding).toBe(false);

    writeConfig({ tools: { selfImplement: { goalAuthorPersistentGrounding: 'false' } } });
    expect(buildUserConfig(configPath).tools.selfImplement.goalAuthorPersistentGrounding).toBeUndefined();

    writeConfig({ tools: { selfImplement: {} } });
    expect(buildUserConfig(configPath).tools.selfImplement.goalAuthorPersistentGrounding).toBeUndefined();
  });
});

describe('runtime llm model/provider compatibility', () => {
  function captureStderr(run: () => void): string {
    const chunks: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return (original as (c: string | Uint8Array, ...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stderr.write;
    try {
      run();
    } finally {
      process.stderr.write = original;
    }
    return chunks.join('');
  }

  test('classifier flags a cross-provider model and accepts a same-provider override', () => {
    expect(inferRuntimeLlmModelFamily('grok-4.6')).toBe('grok');
    expect(inferRuntimeLlmModelFamily('gpt-5.6-terra')).toBe('openai-codex');
    expect(inferRuntimeLlmModelFamily('gpt-5.5')).toBe('openai');
    expect(inferRuntimeLlmModelFamily('o1')).toBe('openai');
    expect(inferRuntimeLlmModelFamily('o3')).toBe('openai');
    expect(inferRuntimeLlmModelFamily('o1-preview')).toBe('openai');
    expect(inferRuntimeLlmModelFamily('o3-mini')).toBe('openai');
    expect(isRuntimeLlmModelCompatibleWithProvider('grok', 'o3')).toBe(false);
    expect(isRuntimeLlmModelCompatibleWithProvider('openai', 'o1')).toBe(true);
    expect(isRuntimeLlmModelCompatibleWithProvider('openai', 'o3')).toBe(true);
    expect(isRuntimeLlmModelCompatibleWithProvider('openai-codex', 'grok-4.6')).toBe(false);
    expect(isRuntimeLlmModelCompatibleWithProvider('openai-codex', 'gpt-5.6-sol')).toBe(true);
    expect(isRuntimeLlmModelCompatibleWithProvider('openai-codex', 'codex-mini')).toBe(true);
    expect(isRuntimeLlmModelCompatibleWithProvider('openai', 'gpt-5.6-sol')).toBe(false);
    expect(isRuntimeLlmModelCompatibleWithProvider('openai', 'gpt-5.5')).toBe(true);
    expect(isRuntimeLlmModelCompatibleWithProvider('openai-codex', 'gpt-4o')).toBe(false);
    expect(isRuntimeLlmModelCompatibleWithProvider('auto', 'grok-4.6')).toBe(true);
    expect(isRuntimeLlmModelCompatibleWithProvider('grok', 'mystery-model')).toBe(true);
  });

  test('model-only env mismatch names both provider and model before a request', () => {
    writeConfig({ llm: { provider: 'openai-codex', model: 'gpt-5.6-terra' } });
    setProcessEnv({ MONAD_LLM_PROVIDER: undefined, MONAD_LLM_MODEL: 'grok-4.6' });
    let cfg;
    const observed = captureStderr(() => {
      cfg = buildUserConfig(configPath);
    });
    expect(cfg!.llm.provider).toBe('openai-codex');
    expect(cfg!.llm.model).toBe('grok-4.6');
    expect(observed).toContain('model-provider mismatch');
    expect(observed).toContain('provider=openai-codex');
    expect(observed).toContain('model=grok-4.6');
  });

  test('same-provider model-only env stays silent', () => {
    writeConfig({ llm: { provider: 'openai-codex', model: 'gpt-5.6-terra' } });
    setProcessEnv({ MONAD_LLM_PROVIDER: undefined, MONAD_LLM_MODEL: 'gpt-5.6-sol' });
    let cfg;
    const observed = captureStderr(() => {
      cfg = buildUserConfig(configPath);
    });
    expect(cfg!.llm.provider).toBe('openai-codex');
    expect(cfg!.llm.model).toBe('gpt-5.6-sol');
    expect(observed).not.toContain('model-provider mismatch');
  });

  test('exact o3 model-only env mismatch names both provider and model before a request', () => {
    writeConfig({ llm: { provider: 'grok', model: 'grok-4.6' } });
    setProcessEnv({ MONAD_LLM_PROVIDER: undefined, MONAD_LLM_MODEL: 'o3' });
    let cfg;
    const observed = captureStderr(() => {
      cfg = buildUserConfig(configPath);
    });
    expect(cfg!.llm.provider).toBe('grok');
    expect(cfg!.llm.model).toBe('o3');
    expect(observed).toContain('model-provider mismatch');
    expect(observed).toContain('provider=grok');
    expect(observed).toContain('model=o3');
  });

  test('openai provider with gpt-5.6-sol model-only env names both values', () => {
    writeConfig({ llm: { provider: 'openai', model: 'gpt-4o' } });
    setProcessEnv({ MONAD_LLM_PROVIDER: undefined, MONAD_LLM_MODEL: 'gpt-5.6-sol' });
    let cfg;
    const observed = captureStderr(() => {
      cfg = buildUserConfig(configPath);
    });
    expect(cfg!.llm.provider).toBe('openai');
    expect(cfg!.llm.model).toBe('gpt-5.6-sol');
    expect(observed).toContain('model-provider mismatch');
    expect(observed).toContain('provider=openai');
    expect(observed).toContain('model=gpt-5.6-sol');
  });

  test('provider env alone picks a subscription model for openai-codex, not the API default', () => {
    writeConfig({ llm: { provider: 'grok', model: 'grok-4.6' } });
    setProcessEnv({ MONAD_LLM_PROVIDER: 'openai-codex', MONAD_LLM_MODEL: undefined });
    const cfg = buildUserConfig(configPath);
    expect(cfg.llm.provider).toBe('openai-codex');
    expect(cfg.llm.model).toBe(lookupLlmTierSpec('openai-codex', 'balanced').model);
    expect(cfg.llm.model).not.toBe('gpt-4o-mini');
  });

  test('both env set keep prior provider and model selection', () => {
    writeConfig({ llm: { provider: 'openai-codex', model: 'gpt-5.6-terra' } });
    setProcessEnv({ MONAD_LLM_PROVIDER: 'grok', MONAD_LLM_MODEL: 'grok-4.6-custom' });
    let cfg;
    const observed = captureStderr(() => {
      cfg = buildUserConfig(configPath);
    });
    expect(cfg!.llm.provider).toBe('grok');
    expect(cfg!.llm.model).toBe('grok-4.6-custom');
    expect(observed).not.toContain('model-provider mismatch');
  });

  test('neither env set keeps config provider and model', () => {
    writeConfig({ llm: { provider: 'openai-codex', model: 'gpt-5.6-terra' } });
    setProcessEnv({ MONAD_LLM_PROVIDER: undefined, MONAD_LLM_MODEL: undefined });
    let cfg;
    const observed = captureStderr(() => {
      cfg = buildUserConfig(configPath);
    });
    expect(cfg!.llm.provider).toBe('openai-codex');
    expect(cfg!.llm.model).toBe('gpt-5.6-terra');
    expect(observed).not.toContain('model-provider mismatch');
  });

  test('runtimeLlmProviderOverride stays undefined when provider env is absent', () => {
    writeConfig({ llm: { provider: 'openai-codex', model: 'gpt-5.6-terra' } });
    setProcessEnv({ MONAD_LLM_PROVIDER: undefined, MONAD_LLM_MODEL: 'grok-4.6' });
    const cfg = buildUserConfig(configPath);
    expect(cfg.llm.provider).toBe('openai-codex');
  });
});

describe('dashboard foldMode', () => {
  test('defaults dashboard.foldMode to task-unit when the key is absent', () => {
    writeConfig({});
    expect(buildUserConfig(configPath).dashboard.foldMode).toBe('task-unit');
  });

  test('keeps an explicit dashboard.foldMode line override', () => {
    writeConfig({ dashboard: { foldMode: 'line' } });
    expect(buildUserConfig(configPath).dashboard.foldMode).toBe('line');
  });

  test('normalizes invalid dashboard.foldMode to task-unit', () => {
    writeConfig({ dashboard: { foldMode: 'bogus' } });
    expect(buildUserConfig(configPath).dashboard.foldMode).toBe('task-unit');
  });

  test('serializes dashboard.foldMode through saveUserConfig', () => {
    writeConfig({ dashboard: { foldMode: 'line' } });
    const cfg = buildUserConfig(configPath);
    saveUserConfig(cfg, configPath);
    expect(buildUserConfig(configPath).dashboard.foldMode).toBe('line');
  });
});

describe('mcp.handshakeTimeoutMs', () => {
  test('parses positive global and server deadlines without an environment variable', () => {
    writeConfig({
      mcp: {
        handshakeTimeoutMs: 12_000,
        servers: [
          { id: 'global', command: ['global-server'] },
          { id: 'server', command: ['server-server'], handshakeTimeoutMs: 15_000 },
        ],
      },
    });

    const cfg = buildUserConfig(configPath);
    expect(cfg.mcp?.handshakeTimeoutMs).toBe(12_000);
    expect(cfg.mcp?.servers).toEqual([
      { id: 'global', transport: 'stdio', command: ['global-server'] },
      { id: 'server', transport: 'stdio', command: ['server-server'], handshakeTimeoutMs: 15_000 },
    ]);
  });

  test('omits zero and sub-millisecond configured deadlines so boot retains a bounded default', () => {
    writeConfig({
      mcp: {
        handshakeTimeoutMs: 0,
        servers: [
          { id: 'zero', command: ['zero-server'], handshakeTimeoutMs: 0 },
          { id: 'fraction', command: ['fraction-server'], handshakeTimeoutMs: 0.5 },
        ],
      },
    });

    const cfg = buildUserConfig(configPath);
    expect(cfg.mcp).toEqual({
      servers: [
        { id: 'zero', transport: 'stdio', command: ['zero-server'] },
        { id: 'fraction', transport: 'stdio', command: ['fraction-server'] },
      ],
    });
  });
});

describe('autoReview and ops loader', () => {
  function captureStderr(run: () => void): string {
    const chunks: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return (original as (c: string | Uint8Array, ...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stderr.write;
    try {
      run();
    } finally {
      process.stderr.write = original;
    }
    return chunks.join('');
  }

  test('copies mode off and a positive depth number', () => {
    writeConfig({ autoReview: { mode: 'off', depth: { maxLightFiles: 3 } } });
    const cfg = buildUserConfig(configPath);
    expect(cfg.autoReview?.mode).toBe('off');
    expect(cfg.autoReview?.depth?.maxLightFiles).toBe(3);
  });

  test('leaves autoReview undefined when the section is absent', () => {
    writeConfig({});
    expect(buildUserConfig(configPath).autoReview).toBeUndefined();
  });

  test('drops an unknown mode without coercing it and warns once', () => {
    writeConfig({ autoReview: { mode: 'sometimes' } });
    let cfg;
    const observed = captureStderr(() => {
      cfg = buildUserConfig(configPath);
    });
    expect(cfg!.autoReview?.mode).toBeUndefined();
    const warnings = observed.split('\\n').filter((line) => line.includes('[user-config] autoReview.mode'));
    expect(warnings).toHaveLength(1);
  });

  test('copies ops.selfHeal.armed only when it is a boolean', () => {
    writeConfig({ ops: { selfHeal: { armed: true } } });
    expect(buildUserConfig(configPath).ops?.selfHeal?.armed).toBe(true);

    writeConfig({ ops: { selfHeal: { armed: 'yes' } } });
    let cfg;
    const observed = captureStderr(() => {
      cfg = buildUserConfig(configPath);
    });
    expect(cfg!.ops).toBeUndefined();
    expect(observed.split('\\n').filter((line) => line.includes('[user-config] ops.selfHeal.armed'))).toHaveLength(1);
  });
});

describe('mcp.widgetServerId', () => {
  test('parses widgetServerId without changing servers or enabled', () => {
    writeConfig({
      mcp: {
        enabled: false,
        widgetServerId: ' xcodebuild ',
        servers: [
          { id: 'xcode', command: ['xcrun', 'mcpbridge'] },
          { id: 'xcodebuild', command: ['xcodebuildmcp', 'mcp'] },
        ],
      },
    });
    const cfg = buildUserConfig(configPath);
    expect(cfg.mcp?.widgetServerId).toBe('xcodebuild');
    expect(cfg.mcp?.enabled).toBe(false);
    expect(cfg.mcp?.servers.map((server) => server.id)).toEqual(['xcode', 'xcodebuild']);
  });

  test('omits widgetServerId when the key is absent so the sole-ready fallback stays the default', () => {
    writeConfig({
      mcp: {
        servers: [{ id: 'xcodebuild', command: ['xcodebuildmcp', 'mcp'] }],
      },
    });
    const cfg = buildUserConfig(configPath);
    expect(cfg.mcp?.widgetServerId).toBeUndefined();
    expect(cfg.mcp?.enabled).toBeUndefined();
    expect(cfg.mcp?.servers).toHaveLength(1);
    expect(cfg.mcp?.servers[0]?.id).toBe('xcodebuild');
  });

  test('preserves widgetServerId when servers are empty so boot can reject unknown ids', () => {
    writeConfig({ mcp: { widgetServerId: 'ghost', servers: [] } });
    const cfg = buildUserConfig(configPath);
    expect(cfg.mcp?.widgetServerId).toBe('ghost');
    expect(cfg.mcp?.servers).toEqual([]);
    expect(cfg.mcp?.enabled).toBeUndefined();
  });

  test('preserves widgetServerId when the servers key is absent', () => {
    writeConfig({ mcp: { widgetServerId: 'ghost' } });
    const cfg = buildUserConfig(configPath);
    expect(cfg.mcp?.widgetServerId).toBe('ghost');
    expect(cfg.mcp?.servers).toEqual([]);
    expect(cfg.mcp?.enabled).toBeUndefined();
  });
});

describe('retired config keys (설정 졸업 0-a)', () => {
  test('finds a retired key in the raw config and observes it once without using its value', () => {
    const dir = mkdtempSync(join(tmpdir(), 'retired-config-'));
    const path = join(dir, 'config.json');
    writeFileSync(path, JSON.stringify({ tools: { selfImplement: { decompositionShadow: { enabled: true } } } }));
    const events: Array<{ category: string; event: string; data: unknown }> = [];
    const original = (debug as { log: typeof debug.log }).log;
    (debug as { log: typeof debug.log }).log = ((category, event, data) => { events.push({ category, event, data }); }) as typeof debug.log;
    __resetRetiredConfigKeysObservationForTests();
    try {
      expect(findRetiredConfigKeys({ tools: { selfImplement: { decompositionShadow: { enabled: true } } } }).map(({ path: p }) => p))
        .toEqual(['tools.selfImplement.decompositionShadow']);
      const config = buildUserConfig(path);
      buildUserConfig(path);
      expect(config.tools.selfImplement.decompositionShadow.enabled).toBe(false);
      const retired = events.filter((entry) => entry.category === 'user-config.retired' && entry.event === 'retired-key-present');
      expect(retired).toHaveLength(1);
      expect(retired[0]!.data).toEqual({ paths: ['tools.selfImplement.decompositionShadow'] });
    } finally {
      (debug as { log: typeof debug.log }).log = original;
      __resetRetiredConfigKeysObservationForTests();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a config without retired keys yields an empty list and no observation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'retired-config-none-'));
    const path = join(dir, 'config.json');
    writeFileSync(path, JSON.stringify({ tools: { selfImplement: { autoOpenPr: true } } }));
    const events: string[] = [];
    const original = (debug as { log: typeof debug.log }).log;
    (debug as { log: typeof debug.log }).log = ((category, event) => { events.push(`${category}/${event}`); }) as typeof debug.log;
    __resetRetiredConfigKeysObservationForTests();
    try {
      expect(findRetiredConfigKeys({ tools: { selfImplement: { autoOpenPr: true } } })).toEqual([]);
      expect(findRetiredConfigKeys({ tools: { selfImplement: null } })).toEqual([]);
      buildUserConfig(path);
      expect(events).not.toContain('user-config.retired/retired-key-present');
    } finally {
      (debug as { log: typeof debug.log }).log = original;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
