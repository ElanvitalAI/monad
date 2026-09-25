// Persona prompt assembler — prepend persona system prompt to base.
//
// PLAN: 내부 문서 `PLAN-discord-rich-light-persona-2026-05-01` §3.2 (M2.2)
//
// LLM call entry (streamLLMWithTools 등) 의 caller 가 base system
// prompt 를 만들 때, 페르소나가 attached 되어 있으면 본 helper 가
// 그 앞에 persona.systemPrompt 를 붙인다. Pure function — caller 의
// LLM call 흐름에 minimal touch (1 줄 wrap).
//
// v1 — single persona prepend. M2.4+ (or G2 sprint 22) 에서 group
// policy mission · group context buffer · multi-persona scenario
// 추가.

import type { PersonaProfile } from './types.js';

export interface AssembledPrompt {
  /** Final composed system prompt. */
  readonly systemPrompt: string;
  /** Source breakdown — for debug / audit log. */
  readonly sources: readonly PromptSource[];
}

export interface PromptSource {
  readonly kind: 'persona' | 'base';
  readonly id?: string;       // personaId for 'persona'
  readonly length: number;
  /** First 80 chars (sans newlines) for telemetry. */
  readonly preview: string;
}

/** Compose a persona's systemPrompt + the caller's existing base
 *  system prompt. Persona prompt is prepended (sets identity first,
 *  then base operational instructions). Empty persona prompt =
 *  base passthrough. */
export function assemblePersonaPrompt(
  persona: PersonaProfile | undefined,
  basePrompt: string,
): AssembledPrompt {
  const sources: PromptSource[] = [];
  const parts: string[] = [];

  if (persona && persona.systemPrompt && persona.systemPrompt.trim()) {
    const sp = persona.systemPrompt;
    parts.push(sp);
    sources.push({
      kind: 'persona', id: persona.personaId,
      length: sp.length, preview: previewLine(sp),
    });
  }
  if (basePrompt && basePrompt.trim()) {
    parts.push(basePrompt);
    sources.push({
      kind: 'base',
      length: basePrompt.length, preview: previewLine(basePrompt),
    });
  }
  return {
    systemPrompt: parts.join('\n\n'),
    sources,
  };
}

function previewLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 80 ? flat.slice(0, 79) + '…' : flat;
}
