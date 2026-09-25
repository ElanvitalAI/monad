// ── PFC-S3.1 follow-up: Andon as a proper Turn hook ──
//
// The skill-runner already prepends `buildAndonPreamble()` to the
// system message directly (see src/skill-runner.ts). This hook
// exposes the same preamble through the plugin-hooks pipeline so
// other subsystems (plugin bootstrap, audit log, cross-cutting
// middleware) see Andon as a first-class Turn hook.
//
// Dual-path is intentional: the direct-prepend path runs BEFORE the
// hook dispatch and produces the same text. Duplicate injection is
// harmless (CRITICAL-gated, short text) and doubles as a safety net
// if the hook dispatcher is ever disabled.

import type { HookHandler } from '../plugin-hooks/types.js';
import { buildAndonPreamble } from './andon.js';

export function buildAndonTurnHook(): HookHandler<'Turn'> {
  return {
    id: 'core:andon',
    event: 'Turn',
    // Priority 2 — after AgentsMd (1) which injects project-wide
    // AGENTS.md preamble, before Route (3) / Mission (5). Andon sits
    // right after persistent project rules so urgency is still ahead
    // of more transient plugin content.
    priority: 2,
    invoke() {
      const preamble = buildAndonPreamble();
      if (!preamble) return {};
      return { systemPromptInject: preamble };
    },
  };
}
