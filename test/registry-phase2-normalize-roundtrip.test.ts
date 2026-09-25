// RFC #2161 Phase 2 — alias normalize round-trip across daemon entry
// points (user-config, multi-llm-bridge, workflow validate).

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __resetCatalogForTests } from '../src/registry/loader';
import { buildUserConfig } from '../src/user-config';
import { writeFileSync } from 'node:fs';
import { readMultiLlmHint } from '../src/acp/multi-llm-bridge';
import { validateWorkflow } from '../src/workflow-runtime/schema';
import { inferProviderFromModel } from '../src/llm';
import { setMonadConfigDir, resetMonadConfigDir } from '../src/monad-config-dir.js';

const prevTestHome = process.env.MONAD_TEST_HOME;

let tmpHome: string;
let cfgPath: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'rfc-p2-'));
  process.env.MONAD_TEST_HOME = tmpHome;
  setMonadConfigDir(join(tmpHome, '.monad'));
  cfgPath = join(tmpHome, '.monad', 'config.json');
  __resetCatalogForTests();
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  resetMonadConfigDir();
  if (prevTestHome === undefined) delete process.env.MONAD_TEST_HOME;
  else process.env.MONAD_TEST_HOME = prevTestHome;
  __resetCatalogForTests();
});

function writeCfg(provider: string): void {
  const dir = join(tmpHome, '.monad');
  require('node:fs').mkdirSync(dir, { recursive: true });
  writeFileSync(
    cfgPath,
    JSON.stringify({ llm: { provider } }),
    'utf-8',
  );
}

describe('user-config normalizeProvider · alias-aware', () => {
  test("'claude' → 'anthropic'", () => {
    writeCfg('claude');
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.llm.provider).toBe('anthropic');
  });

  test("'xai' → 'grok'", () => {
    writeCfg('xai');
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.llm.provider).toBe('grok');
  });

  test("'google' → 'gemini'", () => {
    writeCfg('google');
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.llm.provider).toBe('gemini');
  });

  test("'lm-studio' / 'lmstudio' / 'ollama' → 'local'", () => {
    for (const alias of ['lm-studio', 'lmstudio', 'ollama']) {
      writeCfg(alias);
      const cfg = buildUserConfig(cfgPath);
      expect(cfg.llm.provider).toBe('local');
    }
  });

  test("'codex' → 'openai-codex' (legacy split preserved · Phase 4 will merge)", () => {
    writeCfg('codex');
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.llm.provider).toBe('openai-codex');
  });

  test('canonical id round-trips unchanged', () => {
    for (const id of ['anthropic', 'openai', 'grok', 'gemini', 'local', 'openai-codex', 'auto']) {
      writeCfg(id);
      const cfg = buildUserConfig(cfgPath);
      expect(cfg.llm.provider).toBe(id);
    }
  });

  test('typo / unknown → auto fallback (preserves silent-fallback contract)', () => {
    writeCfg('antrhopic');
    expect(buildUserConfig(cfgPath).llm.provider).toBe('auto');
    writeCfg('mistral');
    expect(buildUserConfig(cfgPath).llm.provider).toBe('auto');
  });
});

describe('multi-llm-bridge readMultiLlmHint · alias normalize on wire', () => {
  test("PWA Showroom 'claude' input → 'anthropic' on wire", () => {
    const hint = readMultiLlmHint({
      monad: {
        multiLlm: {
          targets: [
            { id: 't1', provider: 'claude' },
            { id: 't2', provider: 'xai' },
          ],
        },
      },
    });
    expect(hint).not.toBeNull();
    expect(hint!.targets[0]!.provider).toBe('anthropic');
    expect(hint!.targets[1]!.provider).toBe('grok');
  });

  test('canonical id round-trips', () => {
    const hint = readMultiLlmHint({
      monad: {
        multiLlm: {
          targets: [
            { id: 't1', provider: 'anthropic' },
            { id: 't2', provider: 'gemini' },
          ],
        },
      },
    });
    expect(hint!.targets[0]!.provider).toBe('anthropic');
    expect(hint!.targets[1]!.provider).toBe('gemini');
  });

  test('unknown provider passes through verbatim (caller decides fallback)', () => {
    const hint = readMultiLlmHint({
      monad: {
        multiLlm: {
          targets: [{ id: 't1', provider: 'mistral' }],
        },
      },
    });
    expect(hint!.targets[0]!.provider).toBe('mistral');
  });
});

describe('workflow validate · provider field check', () => {
  test('canonical provider passes', () => {
    const r = validateWorkflow({
      name: 'wf-1',
      description: 'test',
      provider: 'anthropic',
      nodes: [{ id: 'n1', prompt: 'hi' }],
    });
    expect(r.ok).toBe(true);
  });

  test("alias 'claude' passes (Phase 2 contract)", () => {
    const r = validateWorkflow({
      name: 'wf-1',
      description: 'test',
      provider: 'claude',
      nodes: [{ id: 'n1', prompt: 'hi' }],
    });
    expect(r.ok).toBe(true);
  });

  test("'auto' passes", () => {
    const r = validateWorkflow({
      name: 'wf-1',
      description: 'test',
      provider: 'auto',
      nodes: [{ id: 'n1', prompt: 'hi' }],
    });
    expect(r.ok).toBe(true);
  });

  test('unknown provider fails with descriptive error', () => {
    const r = validateWorkflow({
      name: 'wf-1',
      description: 'test',
      provider: 'mistral',
      nodes: [{ id: 'n1', prompt: 'hi' }],
    });
    expect(r.ok).toBe(false);
    const providerIssue = r.issues.find((i) => i.path === 'provider');
    expect(providerIssue).toBeDefined();
    expect(providerIssue!.message).toContain('mistral');
    expect(providerIssue!.message).toContain('valid:');
  });

  test('typo provider fails', () => {
    const r = validateWorkflow({
      name: 'wf-1',
      description: 'test',
      provider: 'antrhopic',
      nodes: [{ id: 'n1', prompt: 'hi' }],
    });
    expect(r.ok).toBe(false);
  });

  test('omitted provider passes (optional)', () => {
    const r = validateWorkflow({
      name: 'wf-1',
      description: 'test',
      nodes: [{ id: 'n1', prompt: 'hi' }],
    });
    expect(r.ok).toBe(true);
  });
});

describe('inferProviderFromModel · registry delegation', () => {
  test('shipping models route via Layer A explicit specs', () => {
    expect(inferProviderFromModel('claude-opus-4-7')).toBe('anthropic');
    expect(inferProviderFromModel('claude-sonnet-4-6')).toBe('anthropic');
    expect(inferProviderFromModel('claude-haiku-4-5')).toBe('anthropic');
    expect(inferProviderFromModel('gpt-5.5')).toBe('openai');
    expect(inferProviderFromModel('grok-4.3')).toBe('grok');
    expect(inferProviderFromModel('gemini-3.1-pro-preview')).toBe('gemini');
  });

  test('legacy alias map (haiku → claude-haiku-4-5) still resolves', () => {
    expect(inferProviderFromModel('haiku')).toBe('anthropic');
    expect(inferProviderFromModel('opus')).toBe('anthropic');
    expect(inferProviderFromModel('sonnet')).toBe('anthropic');
    expect(inferProviderFromModel('flash')).toBe('gemini');
    expect(inferProviderFromModel('mini')).toBe('openai');
  });

  test("'sonnet' resolves to actual model (not stale 'claude-sonnet-4-7')", () => {
    expect(inferProviderFromModel('sonnet')).toBe('anthropic');
  });

  test('local _patterns coverage (Phase 2 was hardcoded if-chain)', () => {
    expect(inferProviderFromModel('gemma-4-26b-a4b-it')).toBe('local');
    expect(inferProviderFromModel('qwen3.6-max')).toBe('local');
    expect(inferProviderFromModel('llama3-70b')).toBe('local');
    expect(inferProviderFromModel('local:custom')).toBe('local');
  });

  test('long-tail prefix scan (Phase 2 fallback)', () => {
    expect(inferProviderFromModel('claude-future-9000')).toBe('anthropic');
    expect(inferProviderFromModel('grok-5')).toBe('grok');
    expect(inferProviderFromModel('codex-vintage')).toBe('openai-codex');
  });

  test('totally unknown returns null', () => {
    expect(inferProviderFromModel('mistral-large')).toBe('local');  // _patterns matches mistral-
    expect(inferProviderFromModel('foo-bar-baz')).toBeNull();
  });
});
