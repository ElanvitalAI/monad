// Node-catalog N2.2 (2026-05-11) — LLM-driven structured extraction.
//
// Asks the model to fill in a schema of `field: 'description'` pairs.
// Output is the parsed JSON object — downstream nodes read
// `$node.output.field`. Returns ok=false when the response is not
// valid JSON, so authors can wire a retry/fallback branch.
//
// This deliberately mirrors but differs from prompt nodes' existing
// `output_format` field: extract is a first-class noun in the visual
// editor (one node = "pull X/Y/Z out of this text"), while
// output_format is a sidecar of a free-form prompt node. Both exist;
// pick whichever expresses the author's intent better.

import type {
  ExtractNode,
  NodeExecContext,
  NodeOutput,
  WorkflowDeps,
} from '../types.js';
import { interpolate } from '../variables.js';

/** Pure: tolerant JSON parse — strips ```json fences and trailing
 *  commentary if the model wraps its output. Returns null on hard
 *  failure. Exposed for unit tests. */
export function parseExtractResponse(response: string): Record<string, unknown> | null {
  if (!response) return null;
  // Strip fenced code blocks (```json ... ``` or ``` ... ```)
  let trimmed = response.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence) trimmed = fence[1].trim();
  // Locate the first '{' and matching last '}' — covers prefixes like
  // "Here's the JSON: {...}" without a regex.
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = trimmed.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function buildPrompt(node: ExtractNode, inputText: string): string {
  const fields = Object.entries(node.extract.schema)
    .map(([k, desc]) => `  "${k}": <${desc}>`)
    .join(',\n');
  const hint = node.extract.hint ? `\n\nContext: ${node.extract.hint}` : '';
  return [
    'You are an extraction engine. Read the input below and emit a JSON',
    'object that fills in the requested fields. Reply with ONLY the JSON',
    '(no commentary, no code fences). Each field is required; use null',
    'for genuinely missing values.',
    hint,
    '',
    'Schema:',
    '{',
    fields,
    '}',
    '',
    'Input:',
    inputText,
  ].join('\n');
}

export async function executeExtractNode(
  node: ExtractNode,
  ctx: NodeExecContext,
  deps: WorkflowDeps,
): Promise<NodeOutput> {
  const startedAt = Date.now();
  const { text: inputText } = interpolate(node.extract.input, {
    arguments: ctx.arguments,
    artifactsDir: ctx.artifactsDir,
    outputs: ctx.outputs,
  });
  const prompt = buildPrompt(node, inputText);
  // Node-catalog v2 (2026-05-11) — retry wrap. We retry on either a
  // thrown error or a JSON parse failure; both signal the LLM didn't
  // emit usable structured output. Exponential backoff starting from
  // `retryDelayMs` (default 250ms).
  const retries = node.extract.retries ?? 0;
  const initialDelay = node.extract.retryDelayMs ?? 250;
  let attempt = 0;
  let lastError = '';
  let lastResponse = '';
  while (attempt <= retries) {
    try {
      lastResponse = await deps.callLLM({
        prompt,
        ...(ctx.resolvedModel !== undefined ? { model: ctx.resolvedModel } : {}),
        ...(ctx.resolvedProvider !== undefined ? { provider: ctx.resolvedProvider } : {}),
        ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
      });
      const parsed = parseExtractResponse(lastResponse);
      if (parsed) {
        return {
          ok: true,
          output: parsed,
          durationMs: Date.now() - startedAt,
        };
      }
      lastError = 'extract: response was not valid JSON object';
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt === retries) break;
    attempt++;
    await new Promise<void>((resolve) => setTimeout(resolve, initialDelay * 2 ** (attempt - 1)));
  }
  return {
    ok: false,
    output: lastResponse,
    error: lastError,
    durationMs: Date.now() - startedAt,
  };
}
