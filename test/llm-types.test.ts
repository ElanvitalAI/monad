// H6 P2 Bundle 1 · local-llm types + parseLocalLlmSpec tests.

import { describe, test, expect } from 'bun:test';
import { parseLocalLlmSpec } from '../src/llm/local-manager/types.js';

describe('parseLocalLlmSpec', () => {
  test('local-llm:<node>:<model> form', () => {
    const r = parseLocalLlmSpec('local-llm:mbp:qwen2.5-32b');
    expect(r).not.toBeNull();
    expect(r!.nodeId).toBe('mbp');
    expect(r!.modelId).toBe('qwen2.5-32b');
    expect(r!.raw).toBe('local-llm:mbp:qwen2.5-32b');
  });

  test('local-llm:<model> implicit local node', () => {
    const r = parseLocalLlmSpec('local-llm:gpt-oss-20b');
    expect(r).not.toBeNull();
    expect(r!.nodeId).toBe('local');
    expect(r!.modelId).toBe('gpt-oss-20b');
  });

  test('legacy local:<model> maps to local node', () => {
    const r = parseLocalLlmSpec('local:llama3-8b');
    expect(r).not.toBeNull();
    expect(r!.nodeId).toBe('local');
    expect(r!.modelId).toBe('llama3-8b');
  });

  test('empty / non-local-llm spec returns null', () => {
    expect(parseLocalLlmSpec('')).toBeNull();
    expect(parseLocalLlmSpec('claude-sonnet-4-6')).toBeNull();
    expect(parseLocalLlmSpec('gpt-4')).toBeNull();
  });

  test('rejects empty node or model segment', () => {
    expect(parseLocalLlmSpec('local-llm::model')).toBeNull();
    expect(parseLocalLlmSpec('local-llm:node:')).toBeNull();
    expect(parseLocalLlmSpec('local:')).toBeNull();
  });

  test('model id can contain dashes and numbers', () => {
    const r = parseLocalLlmSpec('local-llm:node-b:deepseek-r1-distill-70b-mlx');
    expect(r!.nodeId).toBe('node-b');
    expect(r!.modelId).toBe('deepseek-r1-distill-70b-mlx');
  });
});
