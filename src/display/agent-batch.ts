import { C } from '../tui.js';
import { formatAgentBatchStatus } from '../log-entry.js';

export interface AgentBatchDisplayInfo {
  phase: 'start' | 'tick' | 'complete' | 'end';
  batchElapsedMs: number;
  total: number;
  done: number;
  remaining: number;
  runningDescriptions: string[];
  completedDescription?: string;
}

export function agentBatchScratchTitle(skillName: string, info: AgentBatchDisplayInfo): string {
  const label = skillName.trim() || 'skill';
  return info.phase === 'end'
    ? `Agents · ${label} · complete`
    : `Agents · ${label} · ${info.done}/${info.total}`;
}

export function renderAgentBatchScratch(
  info: AgentBatchDisplayInfo,
  opts: { expanded?: boolean; frame?: number } = {},
): string[] {
  const lines: string[] = [
    C.bold(formatAgentBatchStatus(info, {
      expanded: opts.expanded ?? true,
      frame: opts.frame ?? 0,
    })),
    '',
  ];

  if (info.completedDescription) {
    lines.push(`${C.success('done')} ${info.completedDescription}`);
    lines.push('');
  }

  if (info.runningDescriptions.length > 0) {
    lines.push(C.muted('running'));
    for (const desc of info.runningDescriptions) {
      lines.push(`  ${C.warning('◇')} ${desc}`);
    }
  } else if (info.remaining === 0) {
    lines.push(C.success('all agents complete'));
  } else {
    lines.push(C.muted('waiting for agents to start'));
  }

  return lines;
}
