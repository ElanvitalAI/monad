// RFC #2161 Phase 4 — verify the legacy 'anthropic' kind alias is
// accepted (with a deprecation surface) and normalised to the canonical
// 'anthropic-openai-wrap' before storage.

import { describe, expect, test, afterEach } from 'bun:test';
import { parseLlmHostsEnv, setHostsOverride } from '../src/nexus/api/llm-hosts.js';
import { handleLlmHostsConfig } from '../src/nexus/api/llm-hosts-config.js';

afterEach(() => {
  setHostsOverride(null);
  delete process.env.ELANOUS_LLM_HOSTS;
});

describe("parseLlmHostsEnv · legacy 'anthropic' kind alias", () => {
  test('accepts the legacy id + normalises to canonical', () => {
    const out = parseLlmHostsEnv(JSON.stringify([
      { name: 'cloud', kind: 'anthropic', endpoint: 'https://api.anthropic.com' },
    ]));
    expect(out.parseError).toBeUndefined();
    expect(out.hosts).toHaveLength(1);
    expect(out.hosts[0]?.kind).toBe('anthropic-openai-wrap');
    expect(out.deprecations).toBeDefined();
    expect(out.deprecations?.length).toBe(1);
    expect(out.deprecations?.[0]).toContain("kind:'anthropic' is deprecated");
    expect(out.deprecations?.[0]).toContain("'anthropic-openai-wrap'");
  });

  test('canonical kind passes through with no deprecation surface', () => {
    const out = parseLlmHostsEnv(JSON.stringify([
      { name: 'cloud', kind: 'anthropic-openai-wrap', endpoint: 'https://api.anthropic.com' },
    ]));
    expect(out.parseError).toBeUndefined();
    expect(out.hosts[0]?.kind).toBe('anthropic-openai-wrap');
    expect(out.deprecations).toBeUndefined();
  });

  test('mixed array — legacy + canonical → only legacy entry flagged', () => {
    const out = parseLlmHostsEnv(JSON.stringify([
      { name: 'lm', kind: 'lm-studio', endpoint: 'http://lm:1234' },
      { name: 'old', kind: 'anthropic', endpoint: 'https://api.anthropic.com' },
      { name: 'new', kind: 'anthropic-openai-wrap', endpoint: 'https://api.anthropic.com' },
    ]));
    expect(out.hosts).toHaveLength(3);
    expect(out.hosts[1]?.kind).toBe('anthropic-openai-wrap');
    expect(out.hosts[2]?.kind).toBe('anthropic-openai-wrap');
    expect(out.deprecations?.length).toBe(1);
    expect(out.deprecations?.[0]).toContain('(old)');
  });

  test('still rejects truly unknown kinds', () => {
    const out = parseLlmHostsEnv(JSON.stringify([
      { name: 'mystery', kind: 'mistral-host', endpoint: 'http://x' },
    ]));
    expect(out.parseError).toMatch(/unknown kind/);
  });
});

describe('PUT /v1/llm/hosts · legacy alias surfaces deprecations field', () => {
  test('PUT with legacy kind → 200 + deprecations + normalised kind in response', async () => {
    const res = await handleLlmHostsConfig(
      new Request('http://x/v1/llm/hosts', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([{
          name: 'legacy-anthropic',
          kind: 'anthropic',
          endpoint: 'https://api.anthropic.com',
          apiKey: 'sk-ant-redacted',
        }]),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      hosts: Array<{ name: string; kind: string }>;
      deprecations?: string[];
    };
    expect(body.ok).toBe(true);
    expect(body.hosts[0]?.kind).toBe('anthropic-openai-wrap');
    expect(body.deprecations).toBeDefined();
    expect(body.deprecations?.[0]).toContain("(legacy-anthropic)");
  });

  test('GET /v1/llm/hosts surfaces deprecations from env', async () => {
    process.env.ELANOUS_LLM_HOSTS = JSON.stringify([
      { name: 'cloud', kind: 'anthropic', endpoint: 'https://api.anthropic.com' },
    ]);
    const res = await handleLlmHostsConfig(new Request('http://x/v1/llm/hosts'));
    const body = (await res.json()) as {
      hosts: Array<{ kind: string }>;
      deprecations?: string[];
    };
    expect(body.hosts[0]?.kind).toBe('anthropic-openai-wrap');
    expect(body.deprecations?.[0]).toContain('deprecated');
  });
});
