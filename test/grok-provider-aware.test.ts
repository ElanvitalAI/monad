// ── Grok (now provider-agnostic) refactor smoke tests ──
//
// Confirms the former grok-only diff analyzer now routes through
// user-config. Doesn't hit the network — we verify the
// isAnalyzerAvailable() and anyProviderAvailable() gates only.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isAnalyzerAvailable, isGrokAvailable } from '../src/grok';
import { anyProviderAvailable } from '../src/llm';
import { saveTokens } from '../src/oauth/store';
import { saveUserConfig, buildUserConfig, resetUserConfig } from '../src/user-config';

const saved: Record<string, string | undefined> = {};
let root: string;
let cfgPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'grok-provider-'));
  cfgPath = join(root, 'monad', 'config.json');
  for (const k of ['XAI_API_KEY', 'GROK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'LOCAL_LLM_URL']) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  saved.XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME;
  saved.CODEX_HOME = process.env.CODEX_HOME;
  process.env.XDG_CONFIG_HOME = root;
  process.env.CODEX_HOME = join(root, 'codex-home');
  resetUserConfig();
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(root, { recursive: true, force: true });
  resetUserConfig();
});

describe('isAnalyzerAvailable — back-compat alias isGrokAvailable', () => {
  test('alias points at the same function', () => {
    expect(isGrokAvailable).toBe(isAnalyzerAvailable);
  });

  test('false when no providers configured', () => {
    expect(isAnalyzerAvailable()).toBe(false);
  });

  test('true when anthropic env var present', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    expect(isAnalyzerAvailable()).toBe(true);
  });

  test('true when codex OAuth tokens on file (no env var)', () => {
    // Need to bootstrap a config.json with provider=openai-codex so
    // the analyzer knows to look for codex tokens.
    const cfg = buildUserConfig(cfgPath);
    cfg.llm.provider = 'openai-codex';
    saveUserConfig(cfg, cfgPath);
    saveTokens('openai-codex', {
      accessToken: 'A', refreshToken: 'R', expiresAt: Date.now() + 3600_000,
    }, { authMode: 'chatgpt', mirrorCodex: false });
    resetUserConfig();
    expect(isAnalyzerAvailable()).toBe(true);
  });
});

describe('anyProviderAvailable', () => {
  test('false with nothing configured', () => {
    expect(anyProviderAvailable()).toBe(false);
  });

  test('true when env provider is set even if config says provider=auto', () => {
    process.env.XAI_API_KEY = 'xai-env';
    expect(anyProviderAvailable()).toBe(true);
  });

  test('true when config.provider=openai-codex + OAuth tokens, no env', () => {
    const cfg = buildUserConfig(cfgPath);
    cfg.llm.provider = 'openai-codex';
    saveUserConfig(cfg, cfgPath);
    saveTokens('openai-codex', {
      accessToken: 'A', refreshToken: 'R', expiresAt: Date.now() + 3600_000,
    }, { authMode: 'chatgpt', mirrorCodex: false });
    resetUserConfig();
    expect(anyProviderAvailable()).toBe(true);
  });

  test('false when config says local but no baseUrl', () => {
    const cfg = buildUserConfig(cfgPath);
    cfg.llm.provider = 'local';
    saveUserConfig(cfg, cfgPath);
    resetUserConfig();
    expect(anyProviderAvailable()).toBe(false);
  });

  test('true when local + baseUrl set', () => {
    const cfg = buildUserConfig(cfgPath);
    cfg.llm.provider = 'local';
    cfg.llm.baseUrl = 'http://localhost:11434/v1';
    saveUserConfig(cfg, cfgPath);
    resetUserConfig();
    expect(anyProviderAvailable()).toBe(true);
  });
});
