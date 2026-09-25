// Grok-family system-prompt addendum.
//
// Grok is trained to explore broadly, while this repository blocks
// consecutive broad searches at runtime. State the repository's tighter
// exploration rhythm before the guard must redirect a blocked call.

import type { LLMMessage } from '../llm.js';

const GROK_EXPLORATION_DISCIPLINE = `# Grok-family exploration discipline

Your broad-exploration tendency must fit this repository's search limits.
For codebase investigation, start with one focused candidate search and read
the returned candidates before another broad search. Once a search is blocked
or yields useful candidates, do not retry the same broad pattern: narrow the
question, read the evidence already found, and synthesize or take the next
directed action.`;

const GROK_DELEGATED_EXPLORATION = `

When broad or repeated codebase exploration is genuinely needed, use the
active \`Agent\` tool to delegate that read-only exploration instead of issuing
serial broad searches yourself. Do not duplicate the delegated searches.`;

function hasAgentTool(enabledTools: readonly string[] | undefined): boolean {
  return enabledTools?.some(tool => tool.toLowerCase() === 'agent') ?? false;
}

/** Build the Grok-family behavioral discipline addendum. Returns a single
 *  system message; spread by `buildUniversalPreamble` when
 *  `modelFamily === 'grok'`. The delegated-exploration directive is emitted
 *  only when `Agent` is active. */
export function buildGrokFamilyAddendum(
  enabledTools: readonly string[] | undefined,
): LLMMessage[] {
  const delegated = hasAgentTool(enabledTools) ? GROK_DELEGATED_EXPLORATION : '';
  return [{ role: 'system', content: `${GROK_EXPLORATION_DISCIPLINE}${delegated}` }];
}
