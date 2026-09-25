import { formatLine, type DebugEvent } from '../debug/log.js';
import type { DebugCallFrame } from '../debug/call-stack.js';
import type { ExecutionHistoryRecord } from '../execution-history.js';
import type { PromptInjectionLog } from '../prompt-bank/types.js';
import { C } from '../tui.js';
import { colorize, type ThemeTokens } from '../theme/tokens.js';

export interface DebugSurfaceStatus {
  file: boolean;
  mirror: boolean;
  verbose: boolean;
  level: string;
  path: string;
  buffered: number;
}

export interface DebugSurfaceRenderOptions {
  theme?: ThemeTokens;
}

export function renderDebugEventRows(
  events: readonly DebugEvent[],
  opts: DebugSurfaceRenderOptions = {},
): string[] {
  const colors = debugColors(opts.theme);
  return events.map(ev => {
    const time = ev.ts.slice(11, 19);
    const category =
      ev.category.startsWith('llm.') ? colors.accent(ev.category)
      : ev.category.startsWith('agent.') ? colors.info(ev.category)
      : ev.category.startsWith('plugin.') ? colors.success(ev.category)
      : ev.category.startsWith('skill.') || ev.category.startsWith('tool.') ? colors.warning(ev.category)
      : colors.muted(ev.category);
    return `${colors.muted(time)} ${category} ${ev.event}`;
  });
}

export function renderDebugEventDetail(
  event: DebugEvent | null,
  status: DebugSurfaceStatus,
): string {
  if (!event) {
    return [
      '# Debug Detail',
      '',
      `level: ${status.level}`,
      `file: ${status.file ? 'on' : 'off'}`,
      `mirror: ${status.mirror ? 'on' : 'off'}`,
      `verbose: ${status.verbose ? 'on' : 'off'}`,
      `buffered: ${status.buffered}`,
      `path: ${status.path}`,
      '',
      'No debug events captured yet.',
    ].join('\n');
  }
  const data = event.data === undefined ? '(no payload)' : safeJson(event.data);
  return [
    '# Debug Event',
    '',
    `time: ${event.ts}`,
    `category: ${event.category}`,
    `event: ${event.event}`,
    '',
    '## One Line',
    '',
    formatLine(event),
    '',
    '## Payload',
    '',
    '```json',
    data,
    '```',
  ].join('\n');
}

export function renderDebugStack(
  events: readonly DebugEvent[],
  status: DebugSurfaceStatus,
  callStack: readonly DebugCallFrame[] = [],
  executions: readonly ExecutionHistoryRecord[] = [],
  opts: DebugSurfaceRenderOptions = {},
): string {
  const recent = events.slice(-80);
  const counts = new Map<string, number>();
  for (const ev of recent) counts.set(ev.category, (counts.get(ev.category) ?? 0) + 1);
  const topCategories = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([category, count]) => `- ${category}: ${count}`)
    .join('\n') || '- none';

  const flow = recent
    .filter(ev =>
      ev.category.startsWith('agent.')
      || ev.category.startsWith('llm.')
      || ev.category.startsWith('plugin.')
      || ev.category.startsWith('skill.')
      || ev.category.startsWith('tool.')
      || ev.category.startsWith('execution.')
    )
    .slice(-18)
    .map(ev => `- ${ev.ts.slice(11, 19)} ${ev.category} -> ${ev.event}`)
    .join('\n') || '- none';

  const lastPrompt = [...events].reverse().find(ev => ev.category === 'llm.request');
  const lastOutput = [...events].reverse().find(ev =>
    ev.category === 'llm.response.complete'
    || ev.category === 'llm.response.error'
    || ev.category === 'llm.response.status'
  );

  return [
    '# Debug Stack',
    '',
    `level: ${status.level}`,
    `sinks: file=${status.file ? 'on' : 'off'} mirror=${status.mirror ? 'on' : 'off'} verbose=${status.verbose ? 'on' : 'off'}`,
    `buffered: ${status.buffered}`,
    `path: ${status.path}`,
    '',
    '## Recent Activity',
    '',
    callStack.length > 0 ? renderCallStack(callStack, opts) : flow,
    '',
    '## Executions',
    '',
    renderExecutionHistory(executions),
    '',
    '## Categories',
    '',
    topCategories,
    '',
    '## Last LLM',
    '',
    `request: ${lastPrompt ? `${lastPrompt.ts.slice(11, 19)} ${lastPrompt.event}` : 'none'}`,
    `output: ${lastOutput ? `${lastOutput.ts.slice(11, 19)} ${lastOutput.category} ${lastOutput.event}` : 'none'}`,
  ].join('\n');
}

function renderCallStack(frames: readonly DebugCallFrame[], opts: DebugSurfaceRenderOptions): string {
  const colors = debugColors(opts.theme);
  return frames.map(frame => {
    const time = frame.timestamp ? frame.timestamp.slice(11, 19) : '--:--:--';
    const head = `- ${time} ${renderFrameStatus(frame.status, colors)} ${renderFrameKind(frame.kind, colors)} ${frame.label}`;
    const detail = frame.detail ? `\n  ${colors.muted(frame.detail)}` : '';
    const children = frame.children?.length
      ? '\n' + frame.children.map(child => `  - ${renderFrameStatus(child.status, colors)} ${renderFrameKind(child.kind, colors)} ${child.label}`).join('\n')
      : '';
    return `${head}${detail}${children}`;
  }).join('\n') || '- none';
}

function renderFrameKind(kind: DebugCallFrame['kind'], colors = debugColors()): string {
  switch (kind) {
    case 'agent': return colors.info('agent');
    case 'llm': return colors.accent('llm');
    case 'tool': return colors.warning('tool');
    case 'plugin': return colors.success('plugin');
    case 'skill': return colors.warning('skill');
    case 'execution': return colors.warning('exec');
    case 'prompt': return colors.accent('prompt');
    case 'event': return colors.muted('event');
  }
}

function renderFrameStatus(status: DebugCallFrame['status'], colors = debugColors()): string {
  switch (status) {
    case 'active': return colors.warning('●');
    case 'waiting': return colors.muted('○');
    case 'done': return colors.success('✓');
    case 'error': return colors.error('!');
    case 'info': return colors.muted('·');
  }
}

function renderExecutionHistory(records: readonly ExecutionHistoryRecord[]): string {
  if (records.length === 0) return '- none';
  return records.slice(0, 8).map(record => {
    const label = record.taskId
      ? `${record.pluginId ?? 'plugin'}:${record.taskId}`
      : record.spec.title ?? record.spec.command ?? record.id;
    const command = record.spec.command ? ` command=${record.spec.command}` : '';
    const duration = typeof record.durationMs === 'number' ? ` ${record.durationMs}ms` : '';
    return `- ${record.startedAt.slice(11, 19)} ${record.status}${duration} ${label}${command}`;
  }).join('\n');
}

function debugColors(theme?: ThemeTokens) {
  if (!theme) {
    return {
      muted: C.muted,
      accent: C.accent,
      info: C.info,
      success: C.success,
      warning: C.warning,
      error: C.error,
    };
  }
  return {
    muted: colorize(theme.colors.muted),
    accent: colorize(theme.colors.accent),
    info: colorize(theme.colors.info),
    success: colorize(theme.colors.success),
    warning: colorize(theme.colors.warning),
    error: colorize(theme.colors.error),
  };
}

export function renderPromptInjectionDebug(logs: readonly PromptInjectionLog[]): string {
  if (logs.length === 0) {
    return [
      '# Prompt Bank',
      '',
      'No prompt injections recorded yet.',
      '',
      'Use `/prompt select` for a dry-run or `/prompt inject` to build and record an injection.',
    ].join('\n');
  }
  const latest = logs[0]!;
  const rows = logs.slice(0, 20).map(log => {
    const selected = log.selectedFragmentIds.length > 0 ? log.selectedFragmentIds.join(', ') : '-';
    const view = log.activeView ?? '-';
    const model = log.model ?? '-';
    return `- ${log.createdAt.slice(11, 19)} ${log.id} view=${view} model=${model} selected=${selected}`;
  }).join('\n');
  const slots = Object.entries(latest.slots)
    .map(([slot, content]) => `- ${slot}: ${String(content ?? '').length} chars`)
    .join('\n') || '- none';
  return [
    '# Prompt Bank',
    '',
    '## Recent Injections',
    '',
    rows,
    '',
    '## Latest',
    '',
    `id: ${latest.id}`,
    `createdAt: ${latest.createdAt}`,
    `sessionId: ${latest.sessionId ?? '-'}`,
    `turnId: ${latest.turnId ?? '-'}`,
    `model: ${latest.model ?? '-'}`,
    `activeView: ${latest.activeView ?? '-'}`,
    `activePlugin: ${latest.activePlugin ?? '-'}`,
    `tokenEstimate: ${latest.tokenEstimate}`,
    `selected: ${latest.selectedFragmentIds.join(', ') || '-'}`,
    `rejected: ${latest.rejected.length}`,
    '',
    '## Slots',
    '',
    slots,
    '',
    '## Rejected',
    '',
    '```json',
    safeJson(latest.rejected),
    '```',
    '',
    '## Metadata',
    '',
    '```json',
    safeJson(latest.metadata),
    '```',
  ].join('\n');
}

function safeJson(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return JSON.stringify(String(data));
  }
}
