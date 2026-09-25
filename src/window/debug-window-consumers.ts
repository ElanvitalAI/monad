export type DebugWorkbenchPane =
  | 'debug-events'
  | 'debug-detail'
  | 'debug-stack'
  | 'debug-prompts';

export type DebugCompanionTarget = DebugWorkbenchPane | 'all';

export interface DebugWorkbenchColumnSpec {
  readonly title: string;
  readonly widgetInstanceId: string;
  readonly weight: number;
}

export interface DebugCompanionSpec {
  readonly key: DebugWorkbenchPane;
  readonly widgetInstanceId: string;
  readonly title: string;
  readonly status: string;
}

const DEBUG_WORKBENCH_ORDER: readonly DebugWorkbenchPane[] = [
  'debug-events',
  'debug-detail',
  'debug-stack',
  'debug-prompts',
];

const DEBUG_COMPANION_SPECS: Record<DebugWorkbenchPane, DebugCompanionSpec> = {
  'debug-events': {
    key: 'debug-events',
    widgetInstanceId: 'wd-debug-events',
    title: 'Debug Events',
    status: 'companion · live event monitor',
  },
  'debug-detail': {
    key: 'debug-detail',
    widgetInstanceId: 'wd-debug-detail',
    title: 'Debug Detail',
    status: 'companion · event inspector',
  },
  'debug-stack': {
    key: 'debug-stack',
    widgetInstanceId: 'wd-debug-stack',
    title: 'Agent Activity',
    status: 'companion · agent activity monitor',
  },
  'debug-prompts': {
    key: 'debug-prompts',
    widgetInstanceId: 'wd-debug-prompts',
    title: 'Prompt Bank',
    status: 'companion · prompt injection watcher',
  },
};

export function listDebugCompanionKeys(): readonly DebugWorkbenchPane[] {
  return DEBUG_WORKBENCH_ORDER;
}

export function getDebugCompanionSpec(key: DebugWorkbenchPane): DebugCompanionSpec {
  return DEBUG_COMPANION_SPECS[key];
}

export function resolveDebugCompanionTargets(
  needle: string | null | undefined,
): readonly DebugWorkbenchPane[] {
  const normalized = (needle ?? '').trim().toLowerCase();
  if (!normalized || normalized === 'events' || normalized === 'event') return ['debug-events'];
  if (normalized === 'detail' || normalized === 'inspect' || normalized === 'inspector') return ['debug-detail'];
  if (normalized === 'stack' || normalized === 'activity' || normalized === 'agent') return ['debug-stack'];
  if (normalized === 'prompts' || normalized === 'prompt' || normalized === 'bank') return ['debug-prompts'];
  if (normalized === 'all' || normalized === 'quad' || normalized === 'workbench') return listDebugCompanionKeys();
  return [];
}

export function buildDebugWorkbenchColumns(): readonly DebugWorkbenchColumnSpec[] {
  return [
    { title: 'events', widgetInstanceId: 'wd-debug-events', weight: 3 },
    { title: 'detail', widgetInstanceId: 'wd-debug-detail', weight: 4 },
    { title: 'activity', widgetInstanceId: 'wd-debug-stack', weight: 3 },
    { title: 'prompts', widgetInstanceId: 'wd-debug-prompts', weight: 4 },
  ];
}

export function debugWorkbenchIndexForTarget(
  target: DebugWorkbenchPane,
): number {
  return Math.max(0, DEBUG_WORKBENCH_ORDER.indexOf(target));
}
