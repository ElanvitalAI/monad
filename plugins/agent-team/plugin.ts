// ── Agent Team plugin (PFC PX-1) ──
//
// Thin wrapper — the real content is in ./agents/*.md. Those are
// materialised into AgentDefinition objects at startup by
// loadPluginContributedAgents() via the manifest's contributes.agents[].
//
// Future PFC S1 work will grow this module with a Team mailbox,
// SendMessage / TeamCreate / TeamDelete LLM tools, and an agent-roster
// pane. For PX-1 the plugin is declarative-only.

import type { MonadPlugin, PluginContext } from '../../src/plugins/core/types.js';
import { globalHookDispatcher } from '../../src/plugin-hooks/dispatcher.js';
import { globalTaskNotificationQueue } from '../../src/agent/task-notification.js';
import type { TurnHookInput, TurnHookOutput } from '../../src/plugin-hooks/events.js';

// PX-3 P6 dogfood: a Turn hook that prepends a short visible banner
// when pending background task-notifications are queued. The XML
// injection (P2) is already authoritative; this banner just makes the
// pending status more eye-catching for the LLM. Priority 20 = early
// but above the reserved (<10) range.
const bgTaskHook = {
  id: 'agent-team:bg-task-warning',
  event: 'Turn' as const,
  priority: 20,
  invoke(_input: TurnHookInput): TurnHookOutput {
    const n = globalTaskNotificationQueue.size;
    if (n === 0) return {};
    return {
      systemPromptInject:
        `🟡 ${n} background task(s) completed — see <task-notification> in the most recent user message.`,
    };
  },
};

let disposer: (() => void) | null = null;

const agentTeam: MonadPlugin<Record<string, never>> = {
  name: 'agent-team',
  version: '0.2.0',
  description:
    'PFC PX-1 — 5 subagent definitions (explore / plan / research / critic / executor). Future: Team mailbox + SendMessage.',
  initialState() { return {}; },
  panes: {},

  async onActivate(ctx: PluginContext) {
    ctx.log('[agent-team] activated — 5 PFC subagent definitions available to Agent tool');
    // Register the Turn hook. Dispose on deactivate so reactivation
    // doesn't double-register.
    disposer = globalHookDispatcher.register(bgTaskHook);
  },

  async onDeactivate(_ctx: PluginContext) {
    if (disposer) { disposer(); disposer = null; }
  },
};

export default agentTeam;
