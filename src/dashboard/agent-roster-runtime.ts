import type { AgentSurfaceChange, AgentSurfaceState } from '../display/agent-surface.js';
import type { AgentTask } from '../agent/types.js';

export interface DashboardAgentUpdateEvent {
  type: 'agent:update';
  id: string;
  status: AgentSurfaceChange['status'];
  payload?: {
    name: string;
    definitionName: string;
    toolCount: number;
    elapsedMs: number;
    currentTool?: string;
    summary?: string;
    error?: string;
    background?: boolean;
    correlationId?: string;
    parentCorrelationId?: string;
  };
}

function currentTool(state: AgentSurfaceState): string | undefined {
  const entry = [...state.log].reverse().find(({ level }) => level === 'tool');
  const text = entry?.text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').replace(/^\s*⎿\s*/, '').trim();
  return text || undefined;
}

export interface DashboardAgentRosterRuntimeDeps {
  syncTasks: (tasks: readonly AgentTask[]) => AgentSurfaceState[];
  syncTasksWithChanges: (tasks: readonly AgentTask[]) => {
    states: AgentSurfaceState[];
    changes: AgentSurfaceChange[];
  };
  emitChange: (event: DashboardAgentUpdateEvent) => void;
}

export interface DashboardAgentRosterRuntime {
  sync(tasks: readonly AgentTask[], emitEvents: boolean): AgentSurfaceState[];
}

export interface AgentRosterEventPumpDeps {
  runtime: DashboardAgentRosterRuntime;
  listTasks: () => readonly AgentTask[];
  hasSubscribers: () => boolean;
}

export function createAgentRosterEventPump({
  runtime,
  listTasks,
  hasSubscribers,
}: AgentRosterEventPumpDeps): () => void {
  return () => {
    if (hasSubscribers()) runtime.sync(listTasks(), true);
  };
}

export function createDashboardAgentRosterRuntime(
  deps: DashboardAgentRosterRuntimeDeps,
): DashboardAgentRosterRuntime {
  return {
    sync(tasks, emitEvents) {
      if (!emitEvents) return deps.syncTasks(tasks);
      const { states, changes } = deps.syncTasksWithChanges(tasks);
      const backgroundByTaskId = new Map(tasks.map((task) => [task.id, task.background === true]));
      for (const change of changes) {
        deps.emitChange({
          type: 'agent:update',
          id: change.id,
          status: change.status,
          payload: change.state ? (() => {
            const tool = currentTool(change.state);
            return {
            name: change.state.name,
            definitionName: change.state.definitionName,
            toolCount: change.state.toolCount,
            elapsedMs: change.state.elapsedMs,
            ...(tool ? { currentTool: tool } : {}),
            summary: change.state.summary,
            error: change.state.error,
            background: backgroundByTaskId.get(change.id) === true,
            correlationId: change.state.correlationId,
            parentCorrelationId: change.state.parentCorrelationId,
            };
          })() : undefined,
        });
      }
      return states;
    },
  };
}
