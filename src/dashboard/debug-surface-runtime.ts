import type { AgentSurfaceState } from '../display/agent-surface.js';
import type { DebugEvent } from '../debug/log.js';
import type { DebugCallFrame } from '../debug/call-stack.js';
import type { ExecutionHistoryRecord } from '../execution-history.js';
import type { PromptInjectionLog } from '../prompt-bank/types.js';
import type {
  DebugSurfaceStatus,
  DebugSurfaceRenderOptions,
} from '../display/debug-surface.js';
import type { ThemeTokens } from '../theme/tokens.js';

export interface DashboardDebugSurfaceRuntimeDeps {
  renderStack: (
    oldestEvents: readonly DebugEvent[],
    debugStatus: DebugSurfaceStatus,
    callStack?: readonly DebugCallFrame[],
    executionHistory?: readonly ExecutionHistoryRecord[],
    opts?: DebugSurfaceRenderOptions,
  ) => string;
  renderPromptInjectionDebug: (logs: readonly PromptInjectionLog[]) => string;
}

export interface DashboardDebugSurfaceRuntime {
  buildStackText(opts: {
    oldestEvents: readonly DebugEvent[];
    debugStatus: DebugSurfaceStatus;
    callStack: readonly DebugCallFrame[];
    executionHistory: readonly ExecutionHistoryRecord[];
    theme: ThemeTokens | undefined;
  }): string;
  runningAgentCount(agents: readonly AgentSurfaceState[]): number;
  buildPromptText(logs: readonly PromptInjectionLog[]): string;
}

export function createDashboardDebugSurfaceRuntime(
  deps: DashboardDebugSurfaceRuntimeDeps,
): DashboardDebugSurfaceRuntime {
  return {
    buildStackText(opts) {
      return deps.renderStack(
        opts.oldestEvents,
        opts.debugStatus,
        opts.callStack,
        opts.executionHistory,
        { theme: opts.theme },
      );
    },
    runningAgentCount(agents) {
      return agents.filter((agent) => agent.status === 'running').length;
    },
    buildPromptText(logs) {
      return deps.renderPromptInjectionDebug(logs);
    },
  };
}
