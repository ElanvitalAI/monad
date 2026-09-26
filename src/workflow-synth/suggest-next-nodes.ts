// M4-1 (2026-05-12 · Phase 4 N5-1) — context-aware node suggestion.
//
// LLM-driven "what node should I add next?" assistant. Sister module
// of `synthWorkflowFromIntent` — same `callLLM` dep, same JSON loose
// parsing pattern. Wraps a focused prompt that includes:
//   • the current workflow YAML (compact form)
//   • the user's intent / description (optional)
//   • the requested position (after:<nodeId> / before:<nodeId> / parallel)
//   • the 20-node catalog (kind + summary + yamlKey) so the LLM
//     picks from a finite menu instead of inventing kinds
//
// F3 default (ROADMAP §2 · 2026-05-12) — invoked **on user demand**
// (CLI / "Suggest next node" button). No auto-debounce in v1.
//
// Output: N suggestions, each with kind + confidence (0-1) + rationale
// + skeleton (single-node YAML snippet · drop-in for `workflow.nodes`).
// Caller decides UX (1-click insert · reject · cycle).

import { NODE_CATALOG } from '../workflow-runtime/node-catalog.js';
import type { WorkflowDefinition, WorkflowDeps } from '../workflow-runtime/types.js';

export type SuggestPosition =
  | { kind: 'after'; nodeId: string }
  | { kind: 'before'; nodeId: string }
  | { kind: 'parallel' }
  | { kind: 'append' };  // 기본 · workflow 끝에 추가

export interface SuggestNextNodesOpts {
  /** Current workflow being edited. */
  workflow: WorkflowDefinition;
  /** Optional intent / description — what the user wants the next
   *  node to accomplish. Empty string = "general next-step". */
  intent?: string;
  /** Where the suggested node would go. Default `append`. */
  position?: SuggestPosition;
  /** How many suggestions to request (default 3 · capped 1-5). */
  count?: number;
  /** Optional abort signal forwarded to the LLM call. */
  signal?: AbortSignal;
  /** Optional LLM model / provider override. */
  model?: string;
  provider?: string;
}

export interface NodeSuggestion {
  kind: string;
  /** 0.0–1.0 — how confident the LLM is the suggestion fits. */
  confidence: number;
  /** 1-2 sentence rationale (UI shows under the card). */
  rationale: string;
  /** Single-node YAML snippet (drop-in for `workflow.nodes`). */
  skeleton: string;
}

export interface SuggestNextNodesResult {
  ok: boolean;
  suggestions: NodeSuggestion[];
  /** When ok=false: LLM-call or parse failure. */
  error?: string;
}

const DEFAULT_COUNT = 3;
const MIN_COUNT = 1;
const MAX_COUNT = 5;

/** Suggest the next workflow node(s) from current state + intent. */
export async function suggestNextNodes(
  opts: SuggestNextNodesOpts,
  deps: Pick<WorkflowDeps, 'callLLM'>,
): Promise<SuggestNextNodesResult> {
  const count = clamp(opts.count ?? DEFAULT_COUNT, MIN_COUNT, MAX_COUNT);
  const prompt = buildPrompt({ ...opts, count });
  let response: string;
  try {
    response = await deps.callLLM({
      prompt,
      systemPrompt: SUGGEST_SYSTEM_PROMPT,
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.provider ? { provider: opts.provider } : {}),
    });
  } catch (err) {
    return {
      ok: false,
      suggestions: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
  try {
    const suggestions = parseSuggestionsResponse(response);
    return { ok: true, suggestions };
  } catch (err) {
    return {
      ok: false,
      suggestions: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── prompt + parser (exported for unit tests) ──────────────────────

export const SUGGEST_SYSTEM_PROMPT = `당신은 elanous workflow author 의 작성 도우미입니다.

사용자가 작성 중인 workflow YAML 과 의도를 보고, 다음에 추가할 node 를 추천하세요. 추천은 정확히 N 개 · JSON 배열 형식:

[
  {
    "kind": "<node kind from the catalog>",
    "confidence": <0.0-1.0>,
    "rationale": "<1-2 sentences explaining why>",
    "skeleton": "- id: <stable id>\\n  <yamlKey>: ...\\n  depends_on: [<upstream>]"
  },
  ...
]

규칙:
- kind 는 반드시 catalog 에 있는 종류 중 하나
- skeleton 은 한 node 의 YAML snippet (workflow.nodes 배열에 그대로 들어갈 수 있는 형태 · 들여쓰기 보존 · 첫 줄 "- id: ...")
- depends_on 은 position 컨텍스트 위에서 자연스럽게 채우기 (예: position=after:foo → depends_on:[foo])
- 같은 kind 를 두 번 추천하지 말 것 (다양성)
- confidence 가 낮으면 솔직히 낮게 (0.4 등) 점수 매기기
- output 외 다른 텍스트 절대 금지 · 순수 JSON 배열만

응답은 \`\`\`json …\`\`\` fence 또는 plain JSON 둘 다 허용 — caller 가 fence 를 strip 합니다.`;

interface PromptInput {
  workflow: WorkflowDefinition;
  intent?: string | undefined;
  position?: SuggestPosition | undefined;
  count: number;
}

export function buildPrompt(opts: PromptInput): string {
  const lines: string[] = [];
  lines.push(`Current workflow (name = ${opts.workflow.name}):`);
  lines.push('');
  lines.push('```yaml');
  lines.push(renderWorkflowSummary(opts.workflow));
  lines.push('```');
  lines.push('');
  const pos = opts.position ?? { kind: 'append' as const };
  lines.push(`Insertion position: ${describePosition(pos)}`);
  if (opts.intent && opts.intent.trim().length > 0) {
    lines.push(`Intent / description: ${opts.intent.trim()}`);
  }
  lines.push('');
  lines.push(`Catalog (the only kinds you may suggest · ${NODE_CATALOG.length} kinds):`);
  for (const spec of NODE_CATALOG) {
    lines.push(`- ${spec.kind} (${spec.category}): ${spec.summary}`);
  }
  lines.push('');
  lines.push(`Suggest ${opts.count} node(s) — JSON array only.`);
  return lines.join('\n');
}

function describePosition(pos: SuggestPosition): string {
  switch (pos.kind) {
    case 'after': return `after node '${pos.nodeId}' (the suggestion's depends_on should include this node)`;
    case 'before': return `before node '${pos.nodeId}' (the existing node's depends_on should be updated by the caller)`;
    case 'parallel': return 'parallel to existing nodes (sibling — same upstream as some existing node)';
    case 'append': return 'append at the end of the workflow';
  }
}

function renderWorkflowSummary(workflow: WorkflowDefinition): string {
  // Compact YAML-like summary — keeps the LLM context window small
  // when workflows are large. Includes id + variant key + 1-line
  // hint of the body so the LLM understands the chain.
  const lines: string[] = [];
  lines.push(`name: ${workflow.name}`);
  if (workflow.description) lines.push(`description: ${workflow.description}`);
  lines.push('nodes:');
  for (const node of workflow.nodes) {
    const variant = identifyVariantKey(node as unknown as Record<string, unknown>);
    const dep = node.depends_on && node.depends_on.length > 0
      ? ` (depends_on: ${node.depends_on.join(', ')})`
      : '';
    lines.push(`  - id: ${node.id}${dep}`);
    lines.push(`    ${variant}: ...`);
  }
  return lines.join('\n');
}

function identifyVariantKey(node: { [k: string]: unknown }): string {
  // 우선순위: trigger 종 → core → branch / iteration / transform → integration
  const candidates = [
    'scheduleTrigger', 'webhookTrigger', 'discordTrigger', 'telegramTrigger',
    'manualTrigger', 'chatTrigger',
    'prompt', 'bash', 'skill', 'cft', 'approval',
    'if', 'switch', 'iteration',
    'classify', 'extract', 'set', 'filter', 'template',
    'http',
  ];
  for (const k of candidates) {
    if (node[k] !== undefined) return k;
  }
  return '<unknown>';
}

/** Local LLM responses (gemma · qwen · llava) drift in two ways:
 *  • the JSON array gets wrapped in narration ("Here are the
 *    suggestions: [...]") so a plain JSON.parse on the full text
 *    fails before we can inspect it;
 *  • the per-item key is `type` / `name` / `nodeKind` instead of the
 *    documented `kind`.
 *  Both are recoverable. The parser absorbs them so we don't need
 *  to fine-tune every model — production LLMs (claude / gpt) still
 *  return canonical `kind`, so this is purely an additive fallback. */
const KIND_SYNONYMS = ['kind', 'type', 'name', 'nodeKind', 'node_kind'] as const;

function pickKind(item: Record<string, unknown>): string | undefined {
  for (const key of KIND_SYNONYMS) {
    const v = item[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

/** Slice the first balanced top-level `[ ... ]` JSON array out of
 *  noisy text — copes with prose preamble / trailing notes.
 *  Returns the original string unchanged when no candidate array is
 *  found (callers still see the same JSON.parse error). */
export function extractJsonArray(raw: string): string {
  const start = raw.indexOf('[');
  if (start === -1) return raw;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < raw.length; i += 1) {
    const c = raw[i];
    if (inStr) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[') depth += 1;
    else if (c === ']') {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return raw;
}

/** Parse the LLM response into a `NodeSuggestion[]`. Tolerates a
 *  ` ```json ... ``` ` fence, narration around the JSON, and
 *  per-item kind synonyms (`type` / `name` / `nodeKind` /
 *  `node_kind`). Throws when the JSON is malformed or a suggestion
 *  has no kind synonym at all. */
export function parseSuggestionsResponse(raw: string): NodeSuggestion[] {
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  // Try a plain parse first (production LLMs honour the prompt).
  // If that fails, fall back to extracting the first balanced array
  // from the response — handles "Sure! Here are 3 suggestions: [...]".
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch (parseErr) {
    const sliced = extractJsonArray(s);
    if (sliced === s) throw parseErr;
    parsed = JSON.parse(sliced);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('LLM response must be a JSON array of suggestions');
  }
  const out: NodeSuggestion[] = [];
  for (let i = 0; i < parsed.length; i += 1) {
    const item = parsed[i];
    if (!item || typeof item !== 'object') {
      throw new Error(`suggestion[${i}] must be an object`);
    }
    const r = item as Record<string, unknown>;
    const kind = pickKind(r);
    if (!kind) {
      throw new Error(`suggestion[${i}].kind must be a non-empty string`);
    }
    const rawConf = r['confidence'];
    const confidence = typeof rawConf === 'number' ? clamp(rawConf, 0, 1) : 0.5;
    const rationale = typeof r['rationale'] === 'string' ? r['rationale'] : '';
    const skeleton = typeof r['skeleton'] === 'string' ? r['skeleton'] : '';
    out.push({ kind, confidence, rationale, skeleton });
  }
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
