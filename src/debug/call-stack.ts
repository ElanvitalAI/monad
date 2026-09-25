import type { DebugEvent } from './log.js';
import type { AgentSurfaceState } from '../display/agent-surface.js';

export type DebugCallFrameKind =
  | 'agent'
  | 'llm'
  | 'tool'
  | 'plugin'
  | 'skill'
  | 'execution'
  | 'prompt'
  | 'event';

export type DebugCallFrameStatus = 'active' | 'waiting' | 'done' | 'error' | 'info';

export interface DebugCallFrame {
  id: string;
  kind: DebugCallFrameKind;
  status: DebugCallFrameStatus;
  label: string;
  detail?: string;
  timestamp?: string;
  source?: {
    category: string;
    event: string;
  };
  children?: DebugCallFrame[];
}

export interface DebugCallStackSignals {
  request?: DebugEvent | null;
  response?: DebugEvent | null;
  toolLoop?: DebugEvent | null;
}

export interface BuildDebugCallStackOptions {
  events: readonly DebugEvent[];
  agents?: readonly AgentSurfaceState[];
  lastLlm?: DebugCallStackSignals;
  limit?: number;
}

export function buildDebugCallStack(opts: BuildDebugCallStackOptions): DebugCallFrame[] {
  const limit = Math.max(1, Math.min(80, opts.limit ?? 24));
  const frames: DebugCallFrame[] = [];
  const seen = new Set<string>();

  for (const agent of sortAgentsForStack(opts.agents ?? [])) {
    pushUnique(frames, seen, agentFrame(agent));
  }

  const llm = lastLlmFrame(opts.lastLlm);
  if (llm) pushUnique(frames, seen, llm);

  const recentEvents = opts.events
    .filter(isStackRelevantEvent)
    .slice(-limit * 2)
    .reverse();
  for (const ev of recentEvents) {
    if (frames.length >= limit) break;
    pushUnique(frames, seen, eventFrame(ev));
  }

  return frames.slice(0, limit);
}

function sortAgentsForStack(agents: readonly AgentSurfaceState[]): AgentSurfaceState[] {
  const rank: Record<AgentSurfaceState['status'], number> = {
    running: 0,
    queued: 1,
    error: 2,
    cancelled: 3,
    done: 4,
  };
  return agents.slice().sort((a, b) =>
    rank[a.status] - rank[b.status]
    || b.updatedAt - a.updatedAt
    || a.name.localeCompare(b.name),
  );
}

function agentFrame(agent: AgentSurfaceState): DebugCallFrame {
  const status: DebugCallFrameStatus =
    agent.status === 'running' ? 'active'
    : agent.status === 'queued' ? 'waiting'
    : agent.status === 'error' ? 'error'
    : 'done';
  const children = agent.log.slice(-5).map((entry, index): DebugCallFrame => ({
    id: `agent:${agent.id}:tool:${index}:${plain(entry.text)}`,
    kind: entry.level === 'error' ? 'event' : 'tool',
    status: entry.level === 'error' ? 'error' : 'info',
    label: plain(entry.text).trim(),
  }));
  return {
    id: `agent:${agent.id}`,
    kind: 'agent',
    status,
    label: agent.name,
    detail: [
      agent.definitionName,
      `${agent.toolCount} tool${agent.toolCount === 1 ? '' : 's'}`,
      `${Math.round(agent.elapsedMs / 1000)}s`,
      agent.summary ?? agent.error ?? '',
    ].filter(Boolean).join(' · '),
    timestamp: new Date(agent.updatedAt).toISOString(),
    children: children.length > 0 ? children : undefined,
  };
}

function lastLlmFrame(signals: DebugCallStackSignals | undefined): DebugCallFrame | null {
  if (!signals?.request && !signals?.response && !signals?.toolLoop) return null;
  const response = signals.response ?? null;
  const request = signals.request ?? null;
  const toolLoop = signals.toolLoop ?? null;
  const failed = response && (response.category.includes('error') || response.event.includes('error'));
  const active = request && (!response || request.ts > response.ts);
  const event = toolLoop ?? response ?? request!;
  return {
    id: `llm:last:${event.ts}:${event.category}:${event.event}`,
    kind: 'llm',
    status: failed ? 'error' : active ? 'active' : 'done',
    label: toolLoop ? `LLM ${toolLoop.event}` : response ? `LLM ${response.event}` : `LLM ${request!.event}`,
    detail: [
      request ? `request ${request.ts.slice(11, 19)}` : '',
      response ? `response ${response.ts.slice(11, 19)}` : '',
      toolLoop ? `tool-loop ${toolLoop.ts.slice(11, 19)}` : '',
    ].filter(Boolean).join(' · '),
    timestamp: event.ts,
    source: { category: event.category, event: event.event },
  };
}

function isStackRelevantEvent(ev: DebugEvent): boolean {
  return ev.category.startsWith('agent.')
    || ev.category.startsWith('llm.')
    || ev.category.startsWith('plugin.')
    || ev.category.startsWith('skill.')
    || ev.category.startsWith('tool.')
    || ev.category.startsWith('execution.')
    || ev.category.startsWith('prompt.');
}

function eventFrame(ev: DebugEvent): DebugCallFrame {
  return {
    id: `event:${ev.ts}:${ev.category}:${ev.event}`,
    kind: kindForCategory(ev.category),
    status: statusForEvent(ev),
    label: `${ev.category} -> ${ev.event}`,
    detail: summarizeData(ev.data),
    timestamp: ev.ts,
    source: { category: ev.category, event: ev.event },
  };
}

function kindForCategory(category: string): DebugCallFrameKind {
  if (category.startsWith('agent.')) return 'agent';
  if (category.startsWith('llm.')) return 'llm';
  if (category.startsWith('tool.')) return 'tool';
  if (category.startsWith('plugin.')) return 'plugin';
  if (category.startsWith('skill.')) return 'skill';
  if (category.startsWith('execution.')) return 'execution';
  if (category.startsWith('prompt.')) return 'prompt';
  return 'event';
}

function statusForEvent(ev: DebugEvent): DebugCallFrameStatus {
  const text = `${ev.category} ${ev.event}`.toLowerCase();
  if (/(error|failed|exception|aborted|blocked)/.test(text)) return 'error';
  if (/(done|complete|served|end|success)/.test(text)) return 'done';
  if (/(start|request|dispatch|running|tool-loop|status)/.test(text)) return 'active';
  return 'info';
}

function summarizeData(data: unknown): string | undefined {
  if (data === undefined || data === null) return undefined;
  if (typeof data === 'string') return truncate(data.replace(/\s+/g, ' '), 140);
  if (typeof data !== 'object') return String(data);
  const obj = data as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ['name', 'tool', 'skill', 'plugin', 'description', 'prompt', 'message', 'durationMs', 'result']) {
    const value = obj[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key}=${truncate(String(value).replace(/\s+/g, ' '), 60)}`);
    }
  }
  if (parts.length > 0) return parts.join(' ');
  try {
    return truncate(JSON.stringify(data), 140);
  } catch {
    return undefined;
  }
}

function pushUnique(frames: DebugCallFrame[], seen: Set<string>, frame: DebugCallFrame): void {
  if (seen.has(frame.id)) return;
  seen.add(frame.id);
  frames.push(frame);
}

function plain(text: string): string {
  return text.replace(/\x1B\[[0-9;]*m/g, '');
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, Math.max(0, max - 1)) + '…' : text;
}
