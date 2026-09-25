// 2026-05-05 — regression gate for the "two-builder" local provider
// bug. Forensic trace from log/debug-20260505173836 line 454:
//
//   POST http://localhost:1234/v1/chat/completions
//   data: { model: "local-llm:local:qwen3.6-35b-a3b-ud-mlx" }
//                  ^^^^^^^^^^^^^^^^ ← LM Studio expects bare modelId
//
// Two builders existed:
//   - LocalProvider singleton (auto-mode path) — properly stripped
//     via resolveLocalLlmBase
//   - makeOpenAICompatProvider('local', ...) (provider:'local' config
//     path) — sent the raw spec verbatim
//
// Fix: extract `stripLocalLlmSpec()` helper, use from BOTH paths so
// the wire body always carries the bare modelId LM Studio expects.

import { describe, expect, test } from 'bun:test';
import { stripLocalLlmSpec } from '../src/llm.js';

describe('stripLocalLlmSpec — wire-body normalization', () => {
  test('local-llm:<node>:<modelId> → bare modelId (multi-node spec)', () => {
    expect(stripLocalLlmSpec('local-llm:local:qwen3.6-35b-a3b-ud-mlx'))
      .toBe('qwen3.6-35b-a3b-ud-mlx');
    expect(stripLocalLlmSpec('local-llm:node-b:qwen2.5-72b-instruct'))
      .toBe('qwen2.5-72b-instruct');
    expect(stripLocalLlmSpec('local-llm:mbp:gpt-oss-20b-gguf'))
      .toBe('gpt-oss-20b-gguf');
  });

  test('local-llm:<modelId> (implicit local node) → bare modelId', () => {
    expect(stripLocalLlmSpec('local-llm:llama-3-8b'))
      .toBe('llama-3-8b');
  });

  test('legacy local:<modelId> → bare modelId', () => {
    expect(stripLocalLlmSpec('local:qwen3.6-35b'))
      .toBe('qwen3.6-35b');
    expect(stripLocalLlmSpec('local:tinyllama-1b'))
      .toBe('tinyllama-1b');
  });

  test('bare modelId (no prefix) → unchanged (idempotent)', () => {
    expect(stripLocalLlmSpec('qwen3.6-35b-a3b-ud-mlx'))
      .toBe('qwen3.6-35b-a3b-ud-mlx');
    expect(stripLocalLlmSpec('llama-3-8b')).toBe('llama-3-8b');
  });

  test('idempotent on already-stripped values (double strip safe)', () => {
    const once = stripLocalLlmSpec('local-llm:local:qwen3.6-35b');
    const twice = stripLocalLlmSpec(once);
    expect(once).toBe(twice);
    expect(twice).toBe('qwen3.6-35b');
  });

  test('empty / undefined → empty string', () => {
    expect(stripLocalLlmSpec(undefined)).toBe('');
    expect(stripLocalLlmSpec('')).toBe('');
    expect(stripLocalLlmSpec('   ')).toBe('');
  });

  test('handles model ids that contain colons inside the modelId portion', () => {
    // ollama uses "name:tag" — make sure we only strip the spec prefix,
    // not any colons that belong to the model id itself.
    expect(stripLocalLlmSpec('local-llm:local:llama3.1:8b'))
      .toBe('llama3.1:8b');
    expect(stripLocalLlmSpec('local:llama3.1:8b'))
      .toBe('llama3.1:8b');
  });
});
