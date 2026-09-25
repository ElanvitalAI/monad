// ── PX-5 P4: route Turn hook ──
//
// On the first turn (turnNumber == 1) the hook reads the last user
// message, runs keyword detection + $name parsing, and injects a
// "Suggested routes" banner via systemPromptInject. On later turns
// the hook is a no-op — keyword matches from the opening prompt are
// most useful at turn kickoff; repeating the banner every turn would
// pollute the context window.
//
// Priority 3 sits AFTER the AGENTS.md hook (priority 1) and BEFORE
// mission Turn hook (priority 5) — both reserved builtins.

import type { HookHandler } from '../plugin-hooks/types.js';
import type {
  TurnHookInput,
  TurnHookOutput,
} from '../plugin-hooks/events.js';
import type { LLMMessage } from '../llm.js';
import {
  detectKeywords,
  parseExplicitInvocation,
} from './detector.js';
import { globalRouteRegistry, type RouteRegistry } from './registry.js';
import type { CompiledRoute } from './types.js';

export interface RouteTurnHookOpts {
  registry?: RouteRegistry;
  id?: string;
}

export function buildRouteTurnHook(opts: RouteTurnHookOpts = {}): HookHandler<'Turn'> {
  const registry = opts.registry ?? globalRouteRegistry;
  return {
    id: opts.id ?? 'core:route-banner',
    event: 'Turn',
    priority: 3,
    invoke(input: TurnHookInput): TurnHookOutput {
      if (input.turnNumber !== 1) return {};
      const lastUserText = extractLastUserText(input.messages);
      if (!lastUserText) return {};
      const explicit = parseExplicitInvocation(lastUserText);
      const suggestions = detectKeywords(lastUserText, { registry });
      if (!explicit && suggestions.length === 0) return {};
      const banner = formatBanner({
        registry,
        explicitRouteId: explicit?.routeId,
        explicitArgs: explicit?.argsText,
        suggestions,
      });
      return banner ? { systemPromptInject: banner } : {};
    },
  };
}

function extractLastUserText(messages: readonly LLMMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) {
      // Concatenate text-typed blocks.
      const parts: string[] = [];
      for (const block of m.content) {
        if (block && typeof block === 'object' && 'type' in block
            && (block as { type: string }).type === 'text'
            && typeof (block as { text: unknown }).text === 'string') {
          parts.push((block as { text: string }).text);
        }
      }
      return parts.join('\n');
    }
    return '';
  }
  return '';
}

function formatBanner(args: {
  registry: RouteRegistry;
  explicitRouteId?: string;
  explicitArgs?: string;
  suggestions: CompiledRoute[];
}): string {
  const lines: string[] = [];
  if (args.explicitRouteId) {
    const r = args.registry.resolveExplicit(args.explicitRouteId);
    if (r) {
      const argsNote = args.explicitArgs ? ` (args: ${args.explicitArgs})` : '';
      lines.push(`Explicit invocation: $${r.id} → ${r.target.kind}:${r.target.id}${argsNote}`);
    } else {
      lines.push(`Explicit invocation $${args.explicitRouteId} — no matching route registered.`);
    }
  }
  if (args.suggestions.length > 0) {
    lines.push('Suggested routes (keyword match):');
    for (const s of args.suggestions) {
      const label = s.description ?? `${s.target.kind}:${s.target.id}`;
      lines.push(`  - $${s.id}: ${label}`);
    }
  }
  return lines.join('\n');
}
