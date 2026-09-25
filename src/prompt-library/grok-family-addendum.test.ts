import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAnthropicFamilyAddendum } from './anthropic-family-addendum.js';
import { buildCodexFamilyAddendum } from './codex-family-addendum.js';
import { buildGeminiFamilyAddendum } from './gemini-family-addendum.js';
import { buildGpt6FamilyAddendum } from './gpt6-family-addendum.js';
import { buildGrokFamilyAddendum } from './grok-family-addendum.js';
import { buildSessionGuidanceAddendum } from './session-guidance.js';
import {
  buildCodingLifecycleAddendum,
  buildUniversalPreamble,
  resetUniversalPreambleCache,
} from './universal-preamble.js';

function content(messages: ReturnType<typeof buildGrokFamilyAddendum>): string {
  return messages.map(message => String(message.content)).join('\n');
}

function emptyProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'grok-family-addendum-'));
  resetUniversalPreambleCache();
  return cwd;
}

describe('buildGrokFamilyAddendum', () => {
  test('returns one system message with focused exploration discipline', () => {
    const messages = buildGrokFamilyAddendum([]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('system');
    expect(content(messages)).toContain('Grok-family exploration discipline');
    expect(content(messages)).toContain('one focused candidate search');
    expect(content(messages)).not.toContain('`Agent` tool');
  });

  test('adds delegated exploration guidance only when Agent is active, case-insensitively', () => {
    const active = content(buildGrokFamilyAddendum(['agent']));
    const inactive = content(buildGrokFamilyAddendum(['Read', 'Grep']));

    expect(active).toContain('active `Agent` tool');
    expect(active).toContain('Do not duplicate the delegated searches.');
    expect(inactive).not.toContain('`Agent` tool');
    expect(inactive).not.toContain('delegated searches');
  });
});

describe('buildUniversalPreamble — Grok family addendum', () => {
  test('adds the Grok addendum only for grok, preserving other family outputs byte-for-byte', () => {
    const cwd = emptyProject();
    const enabledTools = ['Read'];
    const baseline = buildUniversalPreamble({ cwd, enabledTools });
    const grok = buildUniversalPreamble({ cwd, modelFamily: 'grok', enabledTools });
    const sessionGuidance = buildSessionGuidanceAddendum(enabledTools);
    const common = baseline.slice(0, baseline.length - sessionGuidance.length);

    expect(grok).toEqual([
      ...common,
      ...buildGrokFamilyAddendum(enabledTools),
      ...sessionGuidance,
    ]);

    const expectedAddendum = {
      codex: buildCodexFamilyAddendum,
      gemini: buildGeminiFamilyAddendum,
      claude: buildAnthropicFamilyAddendum,
      // 2026-09-13 — gpt 칸이 «빈 배열」이 아니게 됐다(`gpt6-family-addendum` 착지).
      //   🩸 `gpt-6-astra` 가 이 계열로 떨어지는데 규율이 «없었다» — 인계 §36·§37.
      gpt: buildGpt6FamilyAddendum,
      local: () => [],
      other: () => [],
    } as const;
    for (const modelFamily of ['codex', 'gemini', 'claude', 'gpt', 'local', 'other'] as const) {
      resetUniversalPreambleCache();
      const actual = buildUniversalPreamble({ cwd, modelFamily, enabledTools });
      expect(actual).toEqual([
        ...common,
        ...expectedAddendum[modelFamily](),
        ...sessionGuidance,
      ]);
    }
  });

  test('places Grok after the common lifecycle and before session guidance', () => {
    const cwd = emptyProject();
    const messages = buildUniversalPreamble({ cwd, modelFamily: 'grok', enabledTools: ['Agent'] });
    const contents = messages.map(message => String(message.content));
    const lifecycle = contents.findIndex(value => value.includes('# Coding Agent Pipelines'));
    const grok = contents.findIndex(value => value.includes('# Grok-family exploration discipline'));
    const sessionGuidance = contents.findIndex(value => value.includes('# Session-specific guidance'));

    expect(lifecycle).toBeGreaterThanOrEqual(0);
    expect(grok).toBeGreaterThan(lifecycle);
    expect(sessionGuidance).toBeGreaterThan(grok);
  });
});
