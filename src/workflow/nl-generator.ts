// ROADMAP Tier 1 W1 (2026-05-11) — natural-language → workflow YAML.
//
// Pure dispatcher + LLM call. Mirrors the dependency-injection seam
// pattern in `src/nexus/api/workflow-router.ts` (`RouterLLMCaller`) so
// tests can drive the generator without spinning up an LLM provider.
//
// Wire:
//   POST /v1/workflows/generate body={ prompt, model?, provider?, skills? }
//   200: { yaml: string, definition: WorkflowDefinition, warnings: string[] }
//   422: { error: 'validation_failed', issues: ValidationIssue[], raw: string }
//
// LLM contract — the model MUST emit a single JSON object matching the
// Archon-port workflow schema (`src/workflow-runtime/types.ts`):
//   {
//     name: 'kebab-case',
//     description: '...',
//     model?: 'haiku' | 'gpt-5' | ...,
//     provider?: 'anthropic' | 'openai' | 'grok' | 'gemini',
//     nodes: [
//       { id, bash | prompt | skill (+ arguments) | approval | cft,
//         depends_on?, when? }
//     ]
//   }
// We extract the JSON (fence-tolerant · same 3-pass logic as P2
// grok-crawl), stringify to YAML, and validate via `parseWorkflowYaml`.
// Validation issues come back as warnings so the PWA can show a
// "needs fixup" banner without blocking the user from editing.

import { stringify as yamlStringify } from 'yaml';
import { parseWorkflowYaml } from '../workflow-runtime/parser.js';
import type { ValidationResult } from '../workflow-runtime/schema.js';
import type { WorkflowDefinition } from '../workflow-runtime/types.js';

export interface GenerateWorkflowRequest {
  /** User's natural-language description of the workflow. */
  prompt: string;
  /** Optional LLM model override. */
  model?: string;
  /** Optional provider override (anthropic | openai | grok | gemini | local). */
  provider?: string;
  /** Available skill names to feed the LLM as a constrained vocabulary.
   *  Omitted = no skill list hint in the prompt (LLM may still emit
   *  skill nodes, but validation will catch unknown names downstream). */
  skills?: string[];
  /** When set, the generator treats `prompt` as a refinement instruction
   *  applied to the existing yaml. Otherwise yaml is generated from
   *  scratch. */
  currentYaml?: string;
}

export interface GenerateWorkflowResponse {
  /** YAML stringification of the generated definition. Always set on
   *  success even when validation warnings exist (caller can still
   *  display + edit). */
  yaml: string;
  /** Parsed + validated workflow definition. Omitted when validation
   *  failed — caller should inspect `warnings`. */
  definition?: WorkflowDefinition;
  /** Human-readable validation messages (empty = clean). */
  warnings: string[];
  /** Raw LLM response — useful for debugging when extraction fails. */
  raw: string;
}

/** Dependency-inject seam. The handler swaps in the default streamLLM
 *  caller; tests can pass a stub that returns canned JSON. */
export type GeneratorLLMCaller = (
  systemPrompt: string,
  userPrompt: string,
  opts: { model?: string; provider?: string },
) => Promise<string>;

const SYSTEM_PROMPT = `You are a workflow author for the monad-agent system.
Output a SINGLE JSON object describing a DAG workflow. Schema:

{
  "name": "<kebab-case>",            // required · lowercase a-z 0-9 + dashes
  "description": "<short summary>",   // required · 1-2 sentence purpose hint
  "model": "<optional>",              // optional · haiku/sonnet/opus/gpt-5/grok-4/...
  "provider": "<optional>",           // optional · anthropic/openai/grok/gemini/local
  "nodes": [
    { "id": "<kebab>", "bash": "<shell script>" },
    { "id": "<kebab>", "prompt": "<LLM instruction>" },
    { "id": "<kebab>", "skill": "<skill-name>", "arguments": "<args>" },
    { "id": "<kebab>", "approval": { "message": "...", "delivery": "modal" } }
    // depends_on: ["<other-id>"] to enforce ordering
    // when: "<bash-style condition>" to gate the node
  ]
}

Rules:
1. Output JSON ONLY · no commentary · no markdown fences.
2. Each node has exactly ONE of: bash, prompt, skill, approval, cft.
3. \`name\` MUST be kebab-case (no spaces, no underscores, no caps).
4. Keep workflows minimal — prefer 2-5 nodes unless the user explicitly
   asks for more steps.
5. Use \`$ARGUMENTS\` inside bash/prompt/arguments to reference the
   user's runtime arguments.
6. For sequential flow, set \`depends_on\` to chain nodes.
`;

function buildUserPrompt(req: GenerateWorkflowRequest): string {
  const lines: string[] = [];
  if (req.skills && req.skills.length > 0) {
    lines.push(`Available skill names (use exact spelling): ${req.skills.join(', ')}`);
    lines.push('');
  }
  if (req.currentYaml) {
    lines.push('Existing workflow YAML to refine:');
    lines.push('```yaml');
    lines.push(req.currentYaml);
    lines.push('```');
    lines.push('');
    lines.push(`Refinement request: ${req.prompt}`);
  } else {
    lines.push(`Workflow request: ${req.prompt}`);
  }
  return lines.join('\n');
}

/** Pull a JSON object out of a string that may be wrapped in code
 *  fences or surrounded by prose. Mirrors `extractCrawlJson` from
 *  src/registry/discovery/sources/grok-crawl.ts (same 3-pass logic). */
export function extractWorkflowJson(text: string): Record<string, unknown> | null {
  if (!text || typeof text !== 'string') return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch { /* fall through */ }
  const fenced = text.match(/```(?:json|yaml)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced[1]!);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch { /* fall through */ }
  }
  const braceStart = text.indexOf('{');
  if (braceStart >= 0) {
    let depth = 0;
    for (let i = braceStart; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(text.slice(braceStart, i + 1));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              return parsed as Record<string, unknown>;
            }
          } catch { /* malformed · give up */ }
          break;
        }
      }
    }
  }
  return null;
}

/** Internal default — uses `streamLLM` (same primitive workflow-router
 *  uses) so the call inherits the user's configured default provider. */
async function defaultLLMCaller(
  systemPrompt: string,
  userPrompt: string,
  opts: { model?: string; provider?: string },
): Promise<string> {
  const llm = await import('../llm.js');
  let provider = opts.provider ? llm.PROVIDERS[opts.provider] : undefined;
  if (!provider) provider = llm.resolveDefaultProvider(opts.model);
  const safeModel = llm.isModelCompatible(provider.name, opts.model) ? opts.model : undefined;
  const sopts: Parameters<typeof llm.streamLLM>[2] = {
    ...(safeModel !== undefined ? { model: safeModel } : {}),
    provider,
    // Workflow shape is structural — minimal temperature keeps JSON valid.
    temperature: 0.1,
  };
  return llm.streamLLM(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    () => { /* buffer-only */ },
    sopts,
  );
}

/** Pure dispatcher — extracted so handler tests can drive generation
 *  without spinning up the daemon. */
export async function generateWorkflow(
  req: GenerateWorkflowRequest,
  llm: GeneratorLLMCaller = defaultLLMCaller,
): Promise<GenerateWorkflowResponse> {
  if (!req.prompt || !req.prompt.trim()) {
    return { yaml: '', warnings: ['prompt is required'], raw: '' };
  }
  const userPrompt = buildUserPrompt(req);
  const llmOpts: { model?: string; provider?: string } = {};
  if (req.model !== undefined) llmOpts.model = req.model;
  if (req.provider !== undefined) llmOpts.provider = req.provider;

  const raw = await llm(SYSTEM_PROMPT, userPrompt, llmOpts);
  const parsed = extractWorkflowJson(raw);
  if (!parsed) {
    return {
      yaml: '',
      warnings: ['LLM response did not contain a JSON workflow object'],
      raw,
    };
  }
  const yaml = yamlStringify(parsed);
  const validation: ValidationResult = parseWorkflowYaml(yaml);
  const warnings = validation.issues.map((i: { path: string; message: string }) =>
    i.path ? `${i.path}: ${i.message}` : i.message,
  );
  const response: GenerateWorkflowResponse = { yaml, warnings, raw };
  if (validation.ok && validation.workflow) {
    response.definition = validation.workflow;
  }
  return response;
}
