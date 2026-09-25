// Local LLM preset registry tests.
//
// Covers:
//   - Built-in YAML loads & has the expected catalog (qwen3-thinking,
//     qwen3-instruct, deepseek-r1, gemma3, gpt-oss, openai-default)
//   - Pattern matching · qwen ids → qwen3-thinking, instruct ids →
//     qwen3-instruct, unknown ids → openai-default catch-all
//   - Custom-from-user-params helper produces the expected preset
//   - NULL_PRESET shape (mode='none' equivalent)
//
// 2026-05-05 introduction (replaces hardcoded LocalProvider isQwenLocal).

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  findPresetForModel,
  customPresetFromUserParams,
  listPresets,
  NULL_PRESET,
  _resetPresetCacheForTesting,
} from '../src/llm/local-manager/preset-registry.js';

beforeEach(() => {
  _resetPresetCacheForTesting();
});

describe('preset-registry · built-in catalog', () => {
  test('YAML loads · expected ids present', () => {
    const ids = listPresets().map((p) => p.id);
    expect(ids).toContain('qwen3-thinking');
    expect(ids).toContain('qwen3-instruct');
    expect(ids).toContain('deepseek-r1');
    expect(ids).toContain('gemma3');
    expect(ids).toContain('gpt-oss');
    expect(ids).toContain('openai-default');
  });

  test('qwen3-thinking carries the official sampling recipe', () => {
    const preset = listPresets().find((p) => p.id === 'qwen3-thinking');
    expect(preset).toBeDefined();
    expect(preset!.sampling.temperature).toBe(0.6);
    expect(preset!.sampling.top_p).toBe(0.95);
    expect(preset!.sampling.top_k).toBe(20);
    expect(preset!.sampling.min_p).toBe(0);
    expect(preset!.output.max_tokens).toBe(8192);
    expect(preset!.behaviors.auto_prepend_no_think).toBe(true);
  });

  test('qwen3-instruct carries the official non-thinking sampling recipe', () => {
    const preset = listPresets().find((p) => p.id === 'qwen3-instruct');
    expect(preset).toBeDefined();
    expect(preset!.sampling.temperature).toBe(0.7);
    expect(preset!.sampling.top_p).toBe(0.8);
    expect(preset!.sampling.top_k).toBe(20);
    expect(preset!.sampling.min_p).toBe(0);
    expect(preset!.sampling.presence_penalty).toBe(1.5);
  });

  test('catch-all openai-default matches anything · keeps legacy 0.3/4096', () => {
    const preset = listPresets().find((p) => p.id === 'openai-default');
    expect(preset).toBeDefined();
    expect(preset!.sampling.temperature).toBe(0.3);
    expect(preset!.output.max_tokens).toBe(4096);
    expect(preset!.behaviors.auto_prepend_no_think).toBeFalsy();
  });
});

describe('preset-registry · findPresetForModel pattern matching', () => {
  test('qwen3.6 / qwen3.5 ids → qwen3-thinking', () => {
    const a = findPresetForModel('qwen3.6-35b-a3b-ud-mlx');
    expect(a.id).toBe('qwen3-thinking');
    const b = findPresetForModel('qwen3.5-35b-a3b');
    expect(b.id).toBe('qwen3-thinking');
  });

  test('effective thinking state selects Qwen presets in both directions', () => {
    const thinkingModelId = 'qwen3.6-35b-a3b-ud-mlx';
    const instructModelId = 'qwen3-instruct';

    expect(findPresetForModel(thinkingModelId, true).id).toBe('qwen3-thinking');
    expect(findPresetForModel(thinkingModelId, false).id).toBe('qwen3-instruct');
    expect(findPresetForModel(instructModelId, true).id).toBe('qwen3-thinking');
    expect(findPresetForModel(instructModelId, false).id).toBe('qwen3-instruct');
  });

  const expectNonThinkingRecipe = (modelId: string) => {
    const preset = findPresetForModel(modelId);
    expect(preset.id).toBe('qwen3-instruct');
    expect(preset.sampling).toEqual({
      temperature: 0.7,
      top_p: 0.8,
      top_k: 20,
      min_p: 0,
      presence_penalty: 1.5,
    });
  };

  test('generic instruct identifiers resolve to the non-thinking recipe', () => {
    expectNonThinkingRecipe('qwen3-instruct');
  });

  test('dated instruct identifiers resolve through the same non-thinking rule', () => {
    expectNonThinkingRecipe('qwen3-30b-a3b-instruct-2507');
  });

  test('non-instruction Qwen thinking variants, including dated thinking ids, retain the thinking recipe without repeat suppression', () => {
    for (const modelId of ['qwen3.6-35b-a3b-ud-mlx', 'qwen3-30b-a3b-thinking-2507']) {
      const preset = findPresetForModel(modelId);
      expect(preset.id).toBe('qwen3-thinking');
      expect(preset.sampling).toEqual({ temperature: 0.6, top_p: 0.95, top_k: 20, min_p: 0 });
      expect(preset.sampling.presence_penalty).toBeUndefined();
    }
  });

  test('deepseek-r1 id → deepseek-r1 preset', () => {
    expect(findPresetForModel('deepseek-r1-distill-llama-70b').id).toBe('deepseek-r1');
  });

  test('gemma3 ids → gemma3 preset', () => {
    expect(findPresetForModel('gemma-3-27b-it').id).toBe('gemma3');
    expect(findPresetForModel('gemma3-12b').id).toBe('gemma3');
  });

  test('gpt-oss ids → gpt-oss preset', () => {
    expect(findPresetForModel('gpt-oss-20b-gguf').id).toBe('gpt-oss');
    expect(findPresetForModel('gpt-oss-120b').id).toBe('gpt-oss');
  });

  test('unknown id → openai-default catch-all', () => {
    expect(findPresetForModel('mystery-model-7b').id).toBe('openai-default');
    expect(findPresetForModel('xyzzy').id).toBe('openai-default');
  });

  test('case-insensitive matching (substring path)', () => {
    expect(findPresetForModel('QWEN3.6-MAX').id).toBe('qwen3-thinking');
    expect(findPresetForModel('GEMMA-3-27B').id).toBe('gemma3');
  });
});

describe('preset-registry · customPresetFromUserParams', () => {
  test('full param set produces a preset with id="custom"', () => {
    const p = customPresetFromUserParams({
      temperature: 0.42,
      top_p: 0.9,
      top_k: 50,
      min_p: 0.1,
      presence_penalty: 1.5,
      max_tokens: 2048,
      auto_prepend_no_think: true,
    });
    expect(p.id).toBe('custom');
    expect(p.sampling.temperature).toBe(0.42);
    expect(p.sampling.top_p).toBe(0.9);
    expect(p.sampling.top_k).toBe(50);
    expect(p.sampling.min_p).toBe(0.1);
    expect(p.sampling.presence_penalty).toBe(1.5);
    expect(p.output.max_tokens).toBe(2048);
    expect(p.behaviors.auto_prepend_no_think).toBe(true);
  });

  test('empty params → empty preset (everything undefined)', () => {
    const p = customPresetFromUserParams({});
    expect(p.id).toBe('custom');
    expect(p.sampling.temperature).toBeUndefined();
    expect(p.sampling.top_p).toBeUndefined();
    expect(p.sampling.presence_penalty).toBeUndefined();
    expect(p.output.max_tokens).toBeUndefined();
    expect(p.behaviors.auto_prepend_no_think).toBeUndefined();
  });

  test('partial params only carry the fields that were provided', () => {
    const p = customPresetFromUserParams({ temperature: 0.5, max_tokens: 16384 });
    expect(p.sampling.temperature).toBe(0.5);
    expect(p.sampling.top_p).toBeUndefined();
    expect(p.output.max_tokens).toBe(16384);
    expect(p.behaviors.auto_prepend_no_think).toBeUndefined();
  });
});

describe('preset-registry · NULL_PRESET (mode=none equivalent)', () => {
  test('shape is empty across all sections', () => {
    expect(NULL_PRESET.id).toBe('none');
    expect(Object.keys(NULL_PRESET.sampling)).toHaveLength(0);
    expect(Object.keys(NULL_PRESET.output)).toHaveLength(0);
    expect(Object.keys(NULL_PRESET.behaviors)).toHaveLength(0);
  });
});
