// M2-4 v2 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 3)
// — `elanous voice suggest [--llm]` CLI.
//
// Heuristic mode (default) — pure keyword matcher, no network. Reads
// the active provider/model from user-config so the `--llm` mode hits
// the host the user already configured.
//
// LLM mode (`--llm`) — wraps the active LLM tier (or falls back to a
// local OpenAI-compatible host) so the suggester learns phrases the
// heuristic doesn't cover ("I'm prepping a deposition for next
// Tuesday" → medical_dictation). Failure modes (timeout · parse ·
// network) all gracefully fall back to the heuristic so the command
// never crashes a user's shell.

import {
  createLocalLlmPresetRunner,
  getPreset,
  suggestPresetForText,
  suggestPresetForTextLLM,
  type LlmPresetSuggestion,
  type LlmRunner,
} from '../model-tier/index.js';

export interface RunVoiceSuggestOpts {
  /** The phrase to classify. */
  text: string;
  /** When true, call the LLM (default false = heuristic only). */
  useLlm?: boolean;
  /** Override the OpenAI-compatible base URL (LM Studio default
   *  `http://localhost:1234/v1`). */
  endpoint?: string;
  /** Model id known to the host. Required when `useLlm` is true. */
  model?: string;
  /** Inject a custom runner — primarily a test seam. */
  runner?: LlmRunner;
  /** Hard wall-clock cap in ms (default 5000). */
  timeoutMs?: number;
}

export interface VoiceSuggestResult {
  /** The suggestion returned to the user (heuristic or LLM). */
  suggestion: LlmPresetSuggestion;
  /** Lines to print to stdout. Caller does the IO so tests can assert. */
  output: string[];
  /** Suggested exit code (0 = ok, 2 = usage error). */
  exitCode: number;
}

export async function runVoiceSuggestCommand(
  opts: RunVoiceSuggestOpts,
): Promise<VoiceSuggestResult> {
  const text = opts.text.trim();
  if (text.length === 0) {
    return {
      suggestion: { ...suggestPresetForText(''), source: 'heuristic' },
      output: ['Usage: elanous voice suggest <text...> [--llm]'],
      exitCode: 2,
    };
  }

  let suggestion: LlmPresetSuggestion;
  if (opts.useLlm) {
    const runner = opts.runner
      ?? (opts.model
        ? createLocalLlmPresetRunner({
            model: opts.model,
            ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
          })
        : null);
    if (!runner) {
      return {
        suggestion: { ...suggestPresetForText(text), source: 'heuristic' },
        output: [
          '⚠ --llm requires --model <id> (or wire a custom runner).',
          '  Hint: elanous voice suggest --llm --model google/gemma-4-e4b "doctor visit prep"',
        ],
        exitCode: 2,
      };
    }
    suggestion = await suggestPresetForTextLLM(text, runner, {
      ...(typeof opts.timeoutMs === 'number' ? { timeoutMs: opts.timeoutMs } : {}),
    });
  } else {
    suggestion = { ...suggestPresetForText(text), source: 'heuristic' };
  }

  const spec = getPreset(suggestion.preset);
  const confPct = Math.round(suggestion.confidence * 100);
  const output: string[] = [];
  output.push(`${spec.icon}  ${spec.label}`);
  output.push(`  confidence: ${confPct}% (${suggestion.source})`);
  if (suggestion.matchedKeywords.length > 0) {
    output.push(`  matched: ${suggestion.matchedKeywords.join(', ')}`);
  } else if (suggestion.source === 'llm') {
    output.push('  (LLM gave no explicit keyword highlights)');
  } else {
    output.push('  (no keyword matches · default fallback)');
  }
  output.push('');
  output.push(`  Apply: elanous config set modelTier.preset ${suggestion.preset}`);
  return { suggestion, output, exitCode: 0 };
}
