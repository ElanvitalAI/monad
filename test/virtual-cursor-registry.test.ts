import { describe, expect, test } from 'bun:test';

import {
  createVirtualCursorRegistry,
  type VirtualCursorDescriptor,
} from '../src/display/virtual-cursor-registry.js';

function cursor(
  id: string,
  overrides: Partial<VirtualCursorDescriptor> = {},
): VirtualCursorDescriptor {
  return {
    id,
    kind: 'caret',
    row: 2,
    col: 4,
    visible: true,
    ...overrides,
  };
}

describe('VirtualCursorRegistry', () => {
  test('upsert + get + list preserve descriptors', () => {
    const reg = createVirtualCursorRegistry();
    reg.upsert(cursor('c1', { owner: 'input:chat-main' }));
    reg.upsert(cursor('c2', { kind: 'selection-anchor', row: 9, col: 1 }));
    expect(reg.get('c1')).toEqual(cursor('c1', { owner: 'input:chat-main' }));
    expect(reg.list()).toEqual([
      cursor('c1', { owner: 'input:chat-main' }),
      cursor('c2', { kind: 'selection-anchor', row: 9, col: 1 }),
    ]);
  });

  test('upsert on existing id replaces previous descriptor in place', () => {
    const reg = createVirtualCursorRegistry();
    reg.upsert(cursor('c1', { row: 1, col: 1 }));
    reg.upsert(cursor('c1', { row: 7, col: 8, kind: 'message-cursor' }));
    expect(reg.list()).toEqual([
      cursor('c1', { row: 7, col: 8, kind: 'message-cursor' }),
    ]);
  });

  test('listVisible hides visible:false descriptors', () => {
    const reg = createVirtualCursorRegistry();
    reg.upsert(cursor('shown'));
    reg.upsert(cursor('hidden', { visible: false }));
    expect(reg.listVisible()).toEqual([cursor('shown')]);
  });

  test('listByOwner + clearOwner operate on owner-scoped groups', () => {
    const reg = createVirtualCursorRegistry();
    reg.upsert(cursor('a', { owner: 'workspace:left' }));
    reg.upsert(cursor('b', { owner: 'workspace:left', kind: 'range-selection' }));
    reg.upsert(cursor('c', { owner: 'workspace:right' }));
    expect(reg.listByOwner('workspace:left')).toEqual([
      cursor('a', { owner: 'workspace:left' }),
      cursor('b', { owner: 'workspace:left', kind: 'range-selection' }),
    ]);
    reg.clearOwner('workspace:left');
    expect(reg.list()).toEqual([cursor('c', { owner: 'workspace:right' })]);
  });

  test('remove + clear are idempotent for missing ids / empty registry', () => {
    const reg = createVirtualCursorRegistry();
    expect(() => reg.remove('ghost')).not.toThrow();
    expect(() => reg.clear()).not.toThrow();
    reg.upsert(cursor('live'));
    reg.remove('live');
    expect(reg.list()).toEqual([]);
    reg.clear();
    expect(reg.list()).toEqual([]);
  });

  test('onChange emits registry lifecycle events', () => {
    const reg = createVirtualCursorRegistry();
    const seen: string[] = [];
    reg.onChange((event) => {
      seen.push(
        `${event.type}:${event.descriptor?.id ?? event.id ?? event.owner ?? 'all'}`,
      );
    });
    reg.upsert(cursor('c1', { owner: 'workspace:left' }));
    reg.remove('c1');
    reg.upsert(cursor('c2', { owner: 'workspace:left' }));
    reg.clearOwner('workspace:left');
    reg.upsert(cursor('c3'));
    reg.clear();
    expect(seen).toEqual([
      'upsert:c1',
      'remove:c1',
      'upsert:c2',
      'clear-owner:workspace:left',
      'upsert:c3',
      'clear:all',
    ]);
  });
});
