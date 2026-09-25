import type { DeclarativeWidgetNode, WidgetSpec } from '../ui/declarative/index.js';
import type { Axis } from '../virtual-windows/layout-tree.js';
import type { PaneContent, PaneContentSpec } from '../virtual-windows/pane-content.js';
import type { WindowRegistry } from '../virtual-windows/window-registry.js';
import { buildScenarioWidgetSpecs } from './scenario-mount-node.js';

export interface ScenarioWindowMountDeps {
  readonly registry: WindowRegistry;
  readonly createPaneContent: (spec: PaneContentSpec) => PaneContent;
}

export interface ScenarioPaneTarget {
  readonly windowId: number;
  readonly paneId: string;
}

interface PaneConversion {
  readonly panes: readonly PaneContentSpec[];
  readonly unsupported: readonly string[];
}

function titleForWidget(widget: WidgetSpec): string | undefined {
  const character = widget.character?.trim();
  if (character) return character;
  const config = widget.config as Record<string, unknown> | undefined;
  const configCharacter = typeof config?.['character'] === 'string' ? config['character'].trim() : '';
  if (configCharacter) return configCharacter;
  if (widget.id && widget.id.trim()) return widget.id;
  return undefined;
}

function markdownTextFromList(config: Record<string, unknown> | undefined): string {
  const items = Array.isArray(config?.['items'])
    ? config!['items'].filter((item): item is string => typeof item === 'string')
    : [];
  if (items.length === 0) return '(empty list)';
  return items.map(item => `- ${item}`).join('\n');
}

function scratchText(config: Record<string, unknown> | undefined): string {
  const memoLines = Array.isArray(config?.['memoLines'])
    ? config!['memoLines'].filter((line): line is string => typeof line === 'string')
    : [];
  if (memoLines.length > 0) return memoLines.join('\n');
  const previewLines = Array.isArray(config?.['previewLines'])
    ? config!['previewLines'].filter((line): line is string => typeof line === 'string')
    : [];
  if (previewLines.length > 0) return previewLines.join('\n');
  return '';
}

function paneSpecFromWidget(widget: WidgetSpec): PaneContentSpec | null {
  if (widget.children && widget.children.length > 0) return null;
  const config = widget.config as Record<string, unknown> | undefined;
  const title = titleForWidget(widget);
  switch (widget.type) {
    case 'markdown':
      return {
        kind: 'markdown',
        ...(title ? { title } : {}),
        text: typeof config?.['text'] === 'string' ? config['text'] : '',
      };
    case 'scratch':
      return {
        kind: 'scratch',
        ...(title ? { title } : {}),
        initialText: scratchText(config),
      };
    case 'log': {
      const lines = Array.isArray(config?.['lines'])
        ? config!['lines'].filter((line): line is string => typeof line === 'string')
        : [];
      return {
        kind: 'markdown',
        ...(title ? { title } : {}),
        text: lines.join('\n'),
      };
    }
    case 'list':
      return {
        kind: 'markdown',
        ...(title ? { title } : {}),
        text: markdownTextFromList(config),
      };
    case 'hello-text':
      return {
        kind: 'markdown',
        ...(title ? { title } : {}),
        text: typeof config?.['message'] === 'string' ? config['message'] : 'Hello, world!',
      };
    default:
      return null;
  }
}

export function convertScenarioWidgetsToPaneSpecs(
  widgets: readonly DeclarativeWidgetNode[],
): PaneConversion {
  const built = buildScenarioWidgetSpecs(widgets);
  const panes: PaneContentSpec[] = [];
  const unsupported: string[] = [];
  for (const widget of built) {
    const pane = paneSpecFromWidget(widget);
    if (!pane) {
      unsupported.push(widget.type);
      continue;
    }
    panes.push(pane);
  }
  return {
    panes,
    unsupported: [...new Set(unsupported)].sort(),
  };
}

function mountConvertedScenarioAtPane(
  converted: PaneConversion,
  target: ScenarioPaneTarget,
  deps: ScenarioWindowMountDeps,
): { mounted: boolean; error?: string } {
  const window = deps.registry.get(target.windowId);
  if (!window) {
    return {
      mounted: false,
      error: `RunScenario: target window ${target.windowId} was not found`,
    };
  }
  if (!window.getPane(target.paneId)) {
    return {
      mounted: false,
      error: `RunScenario: target pane ${target.paneId} was not found in window ${target.windowId}`,
    };
  }
  try {
    const replacement = deps.createPaneContent(converted.panes[0]!);
    window.splitPaneAt(target.paneId, 'h', replacement);
    window.closePaneAt(target.paneId);

    const splitAxes: readonly Axis[] = ['v', 'h'];
    for (let i = 1; i < converted.panes.length; i++) {
      const pane = deps.createPaneContent(converted.panes[i]!);
      window.splitFocused(splitAxes[(i - 1) % splitAxes.length]!, pane);
    }
    return { mounted: true };
  } catch (err) {
    return {
      mounted: false,
      error: `RunScenario: target pane mount failed: ${(err as Error).message}`,
    };
  }
}

export function mountScenarioIntoWindow(
  widgets: readonly DeclarativeWidgetNode[],
  windowId: number,
  deps: ScenarioWindowMountDeps,
): { mounted: boolean; error?: string } {
  const converted = convertScenarioWidgetsToPaneSpecs(widgets);
  if (converted.unsupported.length > 0) {
    return {
      mounted: false,
      error:
        'RunScenario: target window mount currently supports only pane-mappable widgets; '
        + `unsupported: ${converted.unsupported.join(', ')}`,
    };
  }
  if (converted.panes.length === 0) {
    return {
      mounted: false,
      error: 'RunScenario: scenario produced zero pane-mappable widgets',
    };
  }
  const window = deps.registry.get(windowId);
  if (!window) {
    return {
      mounted: false,
      error: `RunScenario: target window ${windowId} was not found`,
    };
  }
  return mountConvertedScenarioAtPane(converted, {
    windowId,
    paneId: window.focused,
  }, deps);
}

export function mountScenarioIntoPane(
  widgets: readonly DeclarativeWidgetNode[],
  target: ScenarioPaneTarget,
  deps: ScenarioWindowMountDeps,
): { mounted: boolean; error?: string } {
  const converted = convertScenarioWidgetsToPaneSpecs(widgets);
  if (converted.unsupported.length > 0) {
    return {
      mounted: false,
      error:
        'RunScenario: target pane mount currently supports only pane-mappable widgets; '
        + `unsupported: ${converted.unsupported.join(', ')}`,
    };
  }
  if (converted.panes.length === 0) {
    return {
      mounted: false,
      error: 'RunScenario: scenario produced zero pane-mappable widgets',
    };
  }
  return mountConvertedScenarioAtPane(converted, target, deps);
}
