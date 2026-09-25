// ── Mission router · slash override guard (P2-2 · 2026-05-14) ──
//
// `/c plan this` short-circuits the heuristic + Tier 2 + user-config
// override chain. The slash token always wins. iOS / PWA chips inherit
// automatically — both call POST /v1/llm/route/predict with the raw
// text, so neither client needs a code change to honor the override.

import { describe, expect, test } from 'bun:test';
import {
  detectSlashOverride,
  createMissionRouter,
  type MissionLocalLLMClient,
} from '../src/llm/mission-router';
import { lookupLlmTierSpec } from '../src/model-tier/llm-tier-map';

describe('detectSlashOverride · pattern coverage', () => {
  test('all 5 slashes recognized at the start of input', () => {
    expect(detectSlashOverride('/c plan the migration')?.key).toBe('c');
    expect(detectSlashOverride('/g research this')?.key).toBe('g');
    expect(detectSlashOverride('/o implement the cache')?.key).toBe('o');
    expect(detectSlashOverride('/l quick local check')?.key).toBe('l');
    expect(detectSlashOverride('/h ok')?.key).toBe('h');
  });

  test('leading whitespace is trimmed', () => {
    expect(detectSlashOverride('  /c plan the migration')?.key).toBe('c');
  });

  test('uppercase slash also matches', () => {
    expect(detectSlashOverride('/C plan')?.key).toBe('c');
    expect(detectSlashOverride('/H ok')?.key).toBe('h');
  });

  test('slash without trailing space at end of input is OK', () => {
    expect(detectSlashOverride('/c')?.key).toBe('c');
  });

  test('slash mid-text does NOT match (override is opener-only)', () => {
    expect(detectSlashOverride('please /c plan this')).toBeUndefined();
  });

  test('unknown slash letter is ignored', () => {
    expect(detectSlashOverride('/x plan this')).toBeUndefined();
    expect(detectSlashOverride('/p plan this')).toBeUndefined();
  });

  test('non-slash text is ignored', () => {
    expect(detectSlashOverride('plan the migration')).toBeUndefined();
    expect(detectSlashOverride('')).toBeUndefined();
  });
});

describe('createMissionRouter · slash override semantics', () => {
  test('/c forces claude · ignores plan pattern', async () => {
    const router = createMissionRouter();
    const r = await router.predict({ text: '/c plan the migration' });
    expect(r.provider).toBe('claude');
    expect(r.model).toBe('claude-opus-4-7');
    expect(r.mission).toBe('quick');
    expect(r.confidence).toBe(1.0);
  });

  test('/g forces gemini · ignores build pattern', async () => {
    const router = createMissionRouter();
    const r = await router.predict({ text: '/g implement the parser' });
    expect(r.provider).toBe('gemini');
    expect(r.model).toBe(lookupLlmTierSpec('gemini', 'best').model);
  });

  test('/o forces codex-app-server', async () => {
    const router = createMissionRouter();
    const r = await router.predict({ text: '/o write the helper' });
    expect(r.provider).toBe('codex-app-server');
    expect(r.model).toBe('gpt-5');
  });

  test('/l forces local · model omitted (user-config resolves)', async () => {
    const router = createMissionRouter();
    const r = await router.predict({ text: '/l quick check' });
    expect(r.provider).toBe('local');
    expect(r.model).toBeUndefined();
  });

  test('/h forces claude with haiku model', async () => {
    const router = createMissionRouter();
    const r = await router.predict({ text: '/h ok' });
    expect(r.provider).toBe('claude');
    expect(r.model).toBe('claude-haiku-4-5');
  });

  test('slash override wins over user-config provider override', async () => {
    // User configured plan → gemini. Slash should still force claude.
    const router = createMissionRouter({
      config: {
        missions: { plan: { provider: 'gemini', model: 'gemini-3-pro' } },
      },
    });
    const r = await router.predict({ text: '/c plan the migration' });
    expect(r.provider).toBe('claude');
  });

  test('slash override skips Tier 2 (localLLM not called)', async () => {
    let calls = 0;
    const client: MissionLocalLLMClient = {
      async classify() {
        calls += 1;
        return { mission: 'plan', confidence: 0.9 };
      },
    };
    const router = createMissionRouter({ localLLM: client });
    await router.predict({ text: '/c verbose narrative beyond twenty chars no pattern' });
    expect(calls).toBe(0);
  });

  test('non-slash input still flows through Tier 1 heuristic', async () => {
    const router = createMissionRouter();
    const r = await router.predict({ text: 'plan the migration' });
    expect(r.mission).toBe('plan');
    expect(r.provider).toBe('claude');
    expect(r.confidence).toBe(0.78);
  });
});
