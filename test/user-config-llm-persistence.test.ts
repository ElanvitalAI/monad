import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildUserConfig, reloadUserConfig, resetUserConfig, saveUserConfig, type LLMConfig } from '../src/user-config';

let root: string;
let configPath: string;
let savedEscalateEffort: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'user-config-llm-persistence-'));
  configPath = join(root, 'config.json');
  savedEscalateEffort = process.env.ELANOUS_ESCALATE_EFFORT;
  delete process.env.ELANOUS_ESCALATE_EFFORT;
  resetUserConfig();
});

afterEach(() => {
  if (savedEscalateEffort === undefined) delete process.env.ELANOUS_ESCALATE_EFFORT;
  else process.env.ELANOUS_ESCALATE_EFFORT = savedEscalateEffort;
  resetUserConfig();
  rmSync(root, { recursive: true, force: true });
});

/**
 * Exception boundary: only this fixture writes raw JSON, because invalid
 * non-numeric values cannot be constructed through the typed public API.
 */
function writeRawLlmNormalizationFixture(llm: Record<string, unknown>): void {
  writeFileSync(configPath, JSON.stringify({ llm }), 'utf-8');
}

function expectKeysToRoundTrip(
  actual: LLMConfig,
  expected: Partial<LLMConfig>,
): void {
  const keys = Object.keys(expected) as Array<keyof LLMConfig>;
  const missingKeys = keys.filter(key => actual[key] === undefined);
  expect(missingKeys, `LLM keys dropped during save/reload: ${missingKeys.join(', ')}`).toEqual([]);
  for (const key of keys) expect(actual[key]).toEqual(expected[key]);
}

describe('LLM config persistence', () => {
  test('preserves configured LLM keys through the public save and reload path', () => {
    const llm: Pick<LLMConfig,
      'codexAccountRotation'
      | 'codexAccountRotationThresholdPercent'
      | 'codexAccountRotationThresholdPercentByAccount'
      | 'fallbackChain'
      | 'reasoningLevel'
    > = {
      codexAccountRotation: false,
      codexAccountRotationThresholdPercent: 75,
      codexAccountRotationThresholdPercentByAccount: { default: 50, secondary: 80 },
      fallbackChain: ['codex-rotate', 'grok'],
      reasoningLevel: 'medium',
    };
    const config = buildUserConfig(configPath);
    Object.assign(config.llm, llm);
    saveUserConfig(config, configPath);
    const reloaded = reloadUserConfig(configPath).llm;

    expectKeysToRoundTrip(reloaded, llm);
  });

  test('drops only non-numeric account thresholds during normalization and preserves the valid entries', () => {
    writeRawLlmNormalizationFixture({
      codexAccountRotationThresholdPercentByAccount: {
        default: 50,
        secondary: '80',
        tertiary: null,
        overflow: 101,
      },
    });

    const config = buildUserConfig(configPath);
    expect(config.llm.codexAccountRotationThresholdPercentByAccount).toEqual({ default: 50, overflow: 101 });
    saveUserConfig(config, configPath);

    expect(reloadUserConfig(configPath).llm.codexAccountRotationThresholdPercentByAccount).toEqual({
      default: 50,
      overflow: 101,
    });
  });
});
