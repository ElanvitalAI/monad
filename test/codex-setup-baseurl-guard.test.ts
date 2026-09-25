// ── Stale baseUrl guard tests ──
//
// Covers both the pure classifier (looksLikeLocalLLMServer) and the
// end-to-end setup integration — a LAN URL from a previous `provider:
// local` session must either be cleared (default) or explicitly kept
// before the config is written. Silent passthrough for public URLs
// so Codex-compatible proxies don't nag the user on every setup run.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runCodexSetup,
  looksLikeLocalLLMServer,
  maybePromptStaleBaseUrl,
} from '../src/codex/setup';
import { scriptedIO } from '../src/onboarding';
import { buildUserConfig, type UserConfig } from '../src/user-config';

let root: string;
let cfgPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'codex-base-'));
  cfgPath = join(root, 'config.json');
  process.env.XDG_CONFIG_HOME = root;
  process.env.CODEX_HOME = join(root, 'codex-home');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.CODEX_HOME;
});

describe('looksLikeLocalLLMServer', () => {
  test('recognizes loopback hosts', () => {
    expect(looksLikeLocalLLMServer('http://localhost:8000/v1')).toBe(true);
    expect(looksLikeLocalLLMServer('http://127.0.0.1:1234')).toBe(true);
    expect(looksLikeLocalLLMServer('http://[::1]:11434/v1')).toBe(true);
  });

  test('recognizes RFC 1918 LAN addresses', () => {
    expect(looksLikeLocalLLMServer('http://192.168.0.50:1234/v1')).toBe(true);
    expect(looksLikeLocalLLMServer('http://10.0.0.5:8080')).toBe(true);
    expect(looksLikeLocalLLMServer('http://172.16.1.1')).toBe(true);
    expect(looksLikeLocalLLMServer('http://172.31.5.5:443')).toBe(true);
  });

  test('172.15 / 172.32 are OUTSIDE the private range', () => {
    expect(looksLikeLocalLLMServer('http://172.15.1.1')).toBe(false);
    expect(looksLikeLocalLLMServer('http://172.32.1.1')).toBe(false);
  });

  test('known LLM-server default ports are flagged on any host', () => {
    expect(looksLikeLocalLLMServer('http://some-public-host.com:1234')).toBe(true);
    expect(looksLikeLocalLLMServer('https://foo.example.org:11434')).toBe(true);
  });

  test('public hosts on normal ports → false (likely legit proxy)', () => {
    expect(looksLikeLocalLLMServer('https://codex.my-company.com/v1')).toBe(false);
    expect(looksLikeLocalLLMServer('https://chatgpt.com/backend-api/codex')).toBe(false);
    expect(looksLikeLocalLLMServer('https://api.openai.com/v1')).toBe(false);
  });

  test('malformed / empty input → false (no prompt)', () => {
    expect(looksLikeLocalLLMServer('')).toBe(false);
    expect(looksLikeLocalLLMServer('not-a-url')).toBe(false);
    expect(looksLikeLocalLLMServer('::invalid::')).toBe(false);
  });
});

describe('maybePromptStaleBaseUrl', () => {
  test('undefined baseUrl → passthrough, no input consumed', async () => {
    const io = scriptedIO([]);
    expect(await maybePromptStaleBaseUrl(io, undefined)).toBeUndefined();
  });

  test('public URL → silent passthrough', async () => {
    const io = scriptedIO([]);
    const r = await maybePromptStaleBaseUrl(io, 'https://my-codex-proxy.example.com/v1');
    expect(r).toBe('https://my-codex-proxy.example.com/v1');
  });

  test('LAN URL + default answer → cleared', async () => {
    const io = scriptedIO(['']);
    expect(await maybePromptStaleBaseUrl(io, 'http://192.168.0.50:1234/v1')).toBeUndefined();
  });

  test('LAN URL + explicit 1 → cleared', async () => {
    const io = scriptedIO(['1']);
    expect(await maybePromptStaleBaseUrl(io, 'http://localhost:11434/v1')).toBeUndefined();
  });

  test('LAN URL + explicit 2 → kept verbatim', async () => {
    const io = scriptedIO(['2']);
    expect(await maybePromptStaleBaseUrl(io, 'http://192.168.0.50:1234/v1'))
      .toBe('http://192.168.0.50:1234/v1');
  });
});

describe('runCodexSetup — baseUrl guard integration', () => {
  function seed(overrides: Partial<UserConfig['llm']>): UserConfig {
    const base = buildUserConfig(cfgPath);
    return { ...base, llm: { ...base.llm, ...overrides } as UserConfig['llm'] };
  }

  test('stale LAN baseUrl + default clear → config has no baseUrl on disk', async () => {
    const initial = seed({
      provider: 'local',
      model: 'mlx-community/gemma-4-26b',
      baseUrl: 'http://192.168.0.50:1234/v1',
    });
    const io = scriptedIO([
      '3',  // auth mode: skip
      '',   // model default
      '',   // baseUrl: default = clear
    ]);
    const r = await runCodexSetup({ io, path: cfgPath, initial });
    expect(r.config.llm.provider).toBe('openai-codex');
    expect(r.config.llm.baseUrl).toBeUndefined();
    // Round-trip to disk — the cure has to survive the serializer.
    const reloaded = buildUserConfig(cfgPath);
    expect(reloaded.llm.baseUrl).toBeUndefined();
  });

  test('stale LAN baseUrl + explicit keep → preserved', async () => {
    const initial = seed({
      provider: 'local',
      model: 'local-m',
      baseUrl: 'http://10.0.0.5:1234/v1',
    });
    const io = scriptedIO([
      '3',  // skip auth
      '',   // model default
      '2',  // keep
    ]);
    const r = await runCodexSetup({ io, path: cfgPath, initial });
    expect(r.config.llm.baseUrl).toBe('http://10.0.0.5:1234/v1');
  });

  test('no existing baseUrl → no prompt (extra input would have hung the stream)', async () => {
    const initial = seed({
      provider: 'local',
      model: 'm',
    });
    const io = scriptedIO([
      '3',  // skip
      '',   // model default
      // Deliberately no baseUrl answer — guard must NOT ask.
    ]);
    const r = await runCodexSetup({ io, path: cfgPath, initial });
    expect(r.config.llm.baseUrl).toBeUndefined();
  });

  test('public baseUrl (likely proxy) → silent, preserved through write', async () => {
    const initial = seed({
      provider: 'openai-codex',
      model: 'gpt-5.4',
      baseUrl: 'https://my-codex-proxy.example.com/v1',
    });
    const io = scriptedIO([
      '3',  // skip
      '',   // model default
      // No prompt expected.
    ]);
    const r = await runCodexSetup({ io, path: cfgPath, initial });
    expect(r.config.llm.baseUrl).toBe('https://my-codex-proxy.example.com/v1');
  });
});
