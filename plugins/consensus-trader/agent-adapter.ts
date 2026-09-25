// ── Persona → AgentDefinition adapter ──
//
// Phase D2 — runtime conversion per PLAN §11.4. personas.json remains
// the single source of truth; we derive an AgentDefinition at spawn
// time rather than materialising 54 markdown files in src/agents/.
//
// The system prompt folds voice / bias / frameworks into a coherent
// "be this persona" brief and appends the tagged-output contract
// (STANCE / CONFIDENCE / SUMMARY / RATIONALE) that the parser relies
// on. Callers that want to override the model or tools per-persona
// can pass `over` — unset fields fall through to definition defaults.

import type { AgentDefinition } from '../../src/agent/types.js';
import type { Persona } from './personas.js';

export interface PersonaAdapterOptions {
  /** Extra text prepended BEFORE the persona identity — typically the
   *  commonGround brief emitted by the Data Collector phase (D1).
   *  Shared across all siblings on the same run so the prompt-cache
   *  prefix hits on every persona call. */
  commonGround?: string;
  /** Override definition.model for this persona. */
  model?: string;
  /** Override the tool allowlist. Empty/undefined → no tools. */
  tools?: string[];
  /** Rationale length hint — defaults to 120 words to match the v0.3.0
   *  runner. Tests can shorten this for deterministic token budgets. */
  maxRationaleWords?: number;
}

/** Build the system prompt body. Kept separate so tests can pin the
 *  prompt text without running the full conversion. */
export function buildPersonaSystemPrompt(
  persona: Persona,
  opts: PersonaAdapterOptions = {},
): string {
  const lines: string[] = [];

  if (opts.commonGround) {
    lines.push('## Shared research brief (from Data Collector)');
    lines.push('');
    lines.push(opts.commonGround.trim());
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  lines.push(`You are ${persona.name}, ${persona.role}.`);
  lines.push('');
  lines.push(`Voice: ${persona.voice}`);
  lines.push(`Bias: ${persona.bias}`);
  if (persona.expertise.length) {
    lines.push(`Expertise: ${persona.expertise.slice(0, 6).join('; ')}`);
  }
  if (persona.frameworks.length) {
    lines.push(`Frameworks: ${persona.frameworks.slice(0, 4).join('; ')}`);
  }
  lines.push('');

  const words = opts.maxRationaleWords ?? 120;
  lines.push(`Answer from your distinct perspective. Rationale under ${words} words.`);
  lines.push('');
  lines.push('You MUST format the response EXACTLY like this, including the tags:');
  lines.push('STANCE: bullish | bearish | neutral');
  lines.push('CONFIDENCE: 0.XX   (0.00 = no conviction, 1.00 = certain)');
  lines.push('SUMMARY: <one short sentence>');
  lines.push('RATIONALE: <2–4 sentences explaining your reasoning>');

  return lines.join('\n');
}

/** Derive a full AgentDefinition from a Persona. The `name` field
 *  becomes `persona:<id>` so the AgentRegistry can distinguish persona
 *  runs from the built-in data-collector / aggregator tasks when
 *  listing or pruning. */
export function personaToDefinition(
  persona: Persona,
  opts: PersonaAdapterOptions = {},
): AgentDefinition {
  const def: AgentDefinition = {
    name: `persona:${persona.id}`,
    systemPrompt: buildPersonaSystemPrompt(persona, opts),
    description: `${persona.name} — ${persona.role}`,
  };
  if (opts.model) def.model = opts.model;
  if (opts.tools && opts.tools.length > 0) def.tools = opts.tools;
  return def;
}
