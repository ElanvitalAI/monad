import { describe, expect, test } from 'bun:test';

import { DisplayCoordinator } from '../src/display/coordinator.js';
import {
  convertScenarioWidgetsToPaneSpecs,
  mountScenarioIntoPane,
  mountScenarioIntoWindow,
} from '../src/tool-runtime/scenario-window-mount.js';
import {
  listWidget,
  logWidget,
  type DeclarativeWidgetNode,
  type WidgetSpec,
} from '../src/ui/declarative/index.js';
import { createAddressBook } from '../src/virtual-windows/addressing.js';
import { createPaneContent } from '../src/virtual-windows/pane-content.js';
import { WindowRegistry } from '../src/virtual-windows/window-registry.js';

function makeRegistry(): WindowRegistry {
  return new WindowRegistry({
    addressBook: createAddressBook(),
    coordinator: new DisplayCoordinator({ frameMs: 0 }),
    defaultBounds: () => ({ row: 1, col: 1, width: 120, height: 36 }),
  });
}

describe('scenario-window-mount', () => {
  test('converts simple scenario widgets into pane specs', () => {
    const widgets: WidgetSpec[] = [
      { type: 'log', id: 'scenario-log', character: 'Telemetry', config: { lines: ['a', 'b'] } },
      { type: 'list', id: 'scenario-list', config: { items: ['Overview', 'Tasks'] } },
      { type: 'hello-text', config: { message: 'Heap trend' } },
    ];
    const converted = convertScenarioWidgetsToPaneSpecs(widgets);
    expect(converted.unsupported).toEqual([]);
    expect(converted.panes).toHaveLength(3);
    expect(converted.panes[0]).toMatchObject({
      kind: 'markdown',
      title: 'Telemetry',
      text: 'a\nb',
    });
    expect(converted.panes[1]).toMatchObject({
      kind: 'markdown',
      title: 'scenario-list',
      text: '- Overview\n- Tasks',
    });
    expect(converted.panes[2]).toMatchObject({
      kind: 'markdown',
      text: 'Heap trend',
    });
  });

  test('converts builder-authored scenario widgets into pane specs', () => {
    const widgets: DeclarativeWidgetNode[] = [
      logWidget('Telemetry').setLines(['a', 'b']),
      listWidget('Queue').setItems(['Overview', 'Tasks']),
    ];
    const converted = convertScenarioWidgetsToPaneSpecs(widgets);
    expect(converted.unsupported).toEqual([]);
    expect(converted.panes).toHaveLength(2);
    expect(converted.panes[0]).toMatchObject({
      kind: 'markdown',
      text: 'a\nb',
    });
    expect(converted.panes[1]).toMatchObject({
      kind: 'markdown',
      text: '- Overview\n- Tasks',
    });
  });

  test('mounts pane-mappable widgets into an existing target window', () => {
    const registry = makeRegistry();
    const window = registry.spawn({
      title: 'target',
      initialContent: { kind: 'scratch', initialText: 'old body' },
    });

    const result = mountScenarioIntoWindow(
      [
        { type: 'log', config: { lines: ['> ready'] } },
        { type: 'list', config: { items: ['Overview', 'Tasks'] } },
      ],
      window.id,
      { registry, createPaneContent },
    );

    expect(result).toEqual({ mounted: true });
    const panes = window.listPanes();
    expect(panes).toHaveLength(2);
    expect(panes.every(p => p.content.kind === 'markdown')).toBe(true);
    expect(panes.map(p => p.content.capture())).toEqual([
      '> ready',
      '- Overview\n- Tasks',
    ]);
  });

  test('unsupported widget leaves the target window untouched', () => {
    const registry = makeRegistry();
    const window = registry.spawn({
      title: 'target',
      initialContent: { kind: 'markdown', text: 'original' },
    });

    const result = mountScenarioIntoWindow(
      [{ type: 'state-timeline-viewer', id: 'iul-viewer', config: { autoFollow: true } }],
      window.id,
      { registry, createPaneContent },
    );

    expect(result.mounted).toBe(false);
    expect(result.error).toMatch(/unsupported: state-timeline-viewer/);
    const panes = window.listPanes();
    expect(panes).toHaveLength(1);
    expect(panes[0]!.content.capture()).toBe('original');
  });

  test('mounts pane-mappable widgets into a specific target pane', () => {
    const registry = makeRegistry();
    const window = registry.spawn({
      title: 'target',
      initialContent: { kind: 'markdown', text: 'left' },
    });
    const sibling = createPaneContent({ kind: 'markdown', text: 'right' });
    const siblingId = window.splitFocused('h', sibling);
    const originalRootPaneId = window.listPanes().find(p => p.id !== siblingId)!.id;

    const result = mountScenarioIntoPane(
      [{ type: 'hello-text', config: { message: 'mounted into pane' } }],
      { windowId: window.id, paneId: originalRootPaneId },
      { registry, createPaneContent },
    );

    expect(result).toEqual({ mounted: true });
    const bodies = window.listPanes().map(p => p.content.capture()).sort();
    expect(bodies).toEqual(['mounted into pane', 'right']);
  });

  test('mounts builder-authored pane-mappable widgets into a target window', () => {
    const registry = makeRegistry();
    const window = registry.spawn({
      title: 'target',
      initialContent: { kind: 'scratch', initialText: 'old body' },
    });

    const result = mountScenarioIntoWindow(
      [
        logWidget('Telemetry').setLines(['> ready']),
        listWidget('Queue').setItems(['Overview', 'Tasks']),
      ],
      window.id,
      { registry, createPaneContent },
    );

    expect(result).toEqual({ mounted: true });
    expect(window.listPanes().map(p => p.content.capture())).toEqual([
      '> ready',
      '- Overview\n- Tasks',
    ]);
  });
});
