import { describe, expect, test } from 'bun:test';

import { createChatPickerModalRuntime } from '../src/chat/pickers/modal-runtime.js';
import type { ModalSurface } from '../src/display/modal-stack.js';
import type { Key } from '../src/tui.js';
import type { DispatchResult, PickerBufferView, PickerState } from '../src/chat/pickers/state.js';
import { createChatPickerTestSources } from './helpers/chat-picker-family-fixture.js';

function createFakePicker(dispatchResult: DispatchResult): PickerState {
  return {
    refresh: async () => {},
    mode: () => 'slash',
    dispatch: async () => dispatchResult,
    onBufferEdit: () => {},
    submitAt: async () => dispatchResult,
    slashFiltered: () => [],
    argItems: () => [],
    atItems: () => [],
    skillItems: () => [],
    selectedIdx: () => 0,
    _snapshot: () => ({
      cmdPickerIdx: 0,
      pickerNavigated: false,
      atPickerNavigated: false,
      lastAtKey: '',
      argCacheKey: '',
      atCacheKey: '',
      skillCacheKey: '',
      argItemsLen: 0,
      atItemsLen: 0,
      skillItemsLen: 0,
    }),
  };
}

function modal(id: string): ModalSurface {
  return {
    id,
    kind: 'modal',
    bounds: { row: 1, col: 1, width: 10, height: 3 },
    priority: 100,
    paint: () => '',
  };
}

describe('chat picker modal runtime', () => {
  test('createBindings centralizes shared picker modal callbacks', async () => {
    const runtime = createChatPickerModalRuntime({
      picker: createFakePicker({ consumed: true, action: null }),
      getBufferView: (): PickerBufferView => ({ lines: ['/h'], lineIdx: 0, colIdx: 2 }),
      writeTerminal: () => {},
      getBounds: () => ({ row: 10, col: 1, width: 40, height: 1 }),
      getInputZoneHeight: () => 2,
      onDispatchResult: async (dispatched) => dispatched.consumed,
    });

    const bindings = runtime.createBindings('slash', { maxVisible: 6 });
    expect(bindings.selectedIdx()).toBe(0);
    expect(bindings.maxVisible).toBe(6);
    expect(bindings.getInputZoneHeight()).toBe(2);
    expect(bindings.width).toBe(40);
    expect(await bindings.onKey({ name: 'down' } as any)).toBe('consumed');
  });

  test('createFamily centralizes family assembly from sources + maxVisible', () => {
    const runtime = createChatPickerModalRuntime({
      picker: createFakePicker({ consumed: true, action: null }),
      getBufferView: (): PickerBufferView => ({ lines: ['/h'], lineIdx: 0, colIdx: 2 }),
      writeTerminal: () => {},
      getBounds: () => ({ row: 10, col: 1, width: 40, height: 1 }),
      getInputZoneHeight: () => 2,
      onDispatchResult: async () => true,
    });

    const family = runtime.createFamily({
      bounds: { row: 12, col: 1, width: 30, height: 1 },
      maxVisible: 6,
      sources: {
        ...createChatPickerTestSources(),
        slash: { id: 'chat:slash', getItems: () => [{ name: 'help', aliases: [], description: 'Show help' }] },
        arg: { id: 'chat:arg', getItems: () => [] },
        at: { id: 'chat:at', getItems: () => [] },
        skill: { id: 'chat:skill', getItems: () => [] },
      },
    });

    const slash = family.createSurface('slash');
    expect(family.sources.slash.id).toBe('chat:slash');
    expect(slash.id).toBe('chat:slash');
    expect(slash.bounds.width).toBe(40);
  });

  test('dispatchKey routes picker actions through the shared dispatch handler', async () => {
    const seen: DispatchResult[] = [];
    const runtime = createChatPickerModalRuntime({
      picker: createFakePicker({ consumed: true, action: null }),
      getBufferView: (): PickerBufferView => ({ lines: ['/h'], lineIdx: 0, colIdx: 2 }),
      writeTerminal: () => {},
      getBounds: () => ({ row: 10, col: 1, width: 40, height: 1 }),
      getInputZoneHeight: () => 1,
      onDispatchResult: async (dispatched) => {
        seen.push(dispatched);
        return dispatched.consumed;
      },
    });

    const consumed = await runtime.dispatchKey({
      key: { name: 'down' } as Key,
      source: 'input-loop',
      label: 'main',
    });

    expect(consumed).toBe(true);
    expect(seen).toEqual([{ consumed: true, action: null }]);
  });

  test('syncModal and clearAll own modal handle lifecycle', () => {
    const pushed: string[] = [];
    const disposed: string[] = [];
    const clears: string[] = [];
    const runtime = createChatPickerModalRuntime({
      modalSink: {
        pushModal: (surface) => {
          pushed.push(surface.id);
          return {
            id: surface.id,
            dispose: () => disposed.push(surface.id),
          };
        },
      },
      picker: createFakePicker({ consumed: false }),
      getBufferView: (): PickerBufferView => ({ lines: ['/'], lineIdx: 0, colIdx: 1 }),
      writeTerminal: (chunk) => clears.push(chunk),
      getBounds: () => ({ row: 12, col: 1, width: 30, height: 1 }),
      getInputZoneHeight: () => 1,
      onDispatchResult: async () => false,
    });

    runtime.syncModal({
      kind: 'slash',
      active: true,
      clearRows: 9,
      createSurface: () => modal('chat:slash'),
    });
    runtime.syncModal({
      kind: 'slash',
      active: false,
      clearRows: 9,
      createSurface: () => modal('chat:slash'),
    });
    runtime.syncModal({
      kind: 'arg',
      active: true,
      clearRows: 9,
      createSurface: () => modal('chat:arg'),
    });
    runtime.clearAll();

    expect(pushed).toEqual(['chat:slash', 'chat:arg']);
    expect(disposed).toEqual(['chat:slash', 'chat:arg']);
    expect(clears.length).toBe(2);
  });

  test('syncFamily toggles the active picker and retires inactive siblings', () => {
    const pushed: string[] = [];
    const disposed: string[] = [];
    const runtime = createChatPickerModalRuntime({
      modalSink: {
        pushModal: (surface) => {
          pushed.push(surface.id);
          return {
            id: surface.id,
            dispose: () => disposed.push(surface.id),
          };
        },
      },
      picker: createFakePicker({ consumed: false }),
      getBufferView: (): PickerBufferView => ({ lines: ['/'], lineIdx: 0, colIdx: 1 }),
      writeTerminal: () => {},
      getBounds: () => ({ row: 12, col: 1, width: 30, height: 1 }),
      getInputZoneHeight: () => 1,
      onDispatchResult: async () => false,
    });

    runtime.syncFamily({
      activeKind: 'slash',
      clearRows: 9,
      family: {
        createSurface: (kind) => modal(`chat:${kind}`),
        sources: {
          ...createChatPickerTestSources(),
          slash: { id: 'chat:slash', getItems: () => [1, 2] },
          arg: { id: 'chat:arg', getItems: () => [1] },
          at: { id: 'chat:at', getItems: () => [] },
          skill: { id: 'chat:skill', getItems: () => [] },
        },
      },
    });
    runtime.syncFamily({
      activeKind: 'arg',
      clearRows: 9,
      family: {
        createSurface: (kind) => modal(`chat:${kind}`),
        sources: {
          ...createChatPickerTestSources(),
          slash: { id: 'chat:slash', getItems: () => [1, 2] },
          arg: { id: 'chat:arg', getItems: () => [1] },
          at: { id: 'chat:at', getItems: () => [] },
          skill: { id: 'chat:skill', getItems: () => [] },
        },
      },
    });

    expect(pushed).toEqual(['chat:slash', 'chat:arg']);
    expect(disposed).toContain('chat:slash');
  });
});
