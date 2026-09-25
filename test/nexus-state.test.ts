// NEXUS · state + tab-registry tests (Phase N-1 PR α)

import { describe, test, expect } from 'bun:test';
import { createNexusState, pushEvent } from '../src/nexus/state/state.js';
import { TabRegistry } from '../src/nexus/state/tab-registry.js';
import type { TabSpec } from '../src/nexus/kinds/types.js';

function makeSpec(id: string, kind: TabSpec['kind'] = 'chat'): TabSpec {
  return { id, kind, label: `tab-${id}` };
}

describe('nexus/state', () => {
  test('createNexusState seeds version + phase + empty maps', () => {
    const s = createNexusState({ nexusVersion: '0.1.0', phase: 'N-1' });
    expect(s.nexusVersion).toBe('0.1.0');
    expect(s.phase).toBe('N-1');
    expect(s.tabs).toEqual({});
    expect(s.events).toEqual([]);
    expect(typeof s.startedAt).toBe('number');
    expect(s.template).toBeUndefined();
  });

  test('createNexusState records template when provided', () => {
    const s = createNexusState({ nexusVersion: '0.1.0', phase: 'N-1', template: 'voice' });
    expect(s.template).toBe('voice');
  });

  test('pushEvent attaches a timestamp', () => {
    const s = createNexusState({ nexusVersion: '0.1.0', phase: 'N-1' });
    const e = pushEvent(s, { kind: 'nexus.boot' });
    expect(e.kind).toBe('nexus.boot');
    expect(typeof e.ts).toBe('number');
    expect(s.events).toHaveLength(1);
  });

  test('pushEvent ring buffer caps at 1000', () => {
    const s = createNexusState({ nexusVersion: '0.1.0', phase: 'N-1' });
    for (let i = 0; i < 1500; i += 1) pushEvent(s, { kind: 'tab.up', tabId: `t${i}` });
    expect(s.events.length).toBe(1000);
    expect(s.events[0].tabId).toBe('t500');                   // oldest 500 dropped
    expect(s.events[999].tabId).toBe('t1499');                // newest preserved
  });
});

describe('nexus/tab-registry', () => {
  test('register adds a tab with idle status by default', () => {
    const s = createNexusState({ nexusVersion: '0.1.0', phase: 'N-1' });
    const reg = new TabRegistry(s);
    const tab = reg.register(makeSpec('chat-1'));
    expect(tab.spec.id).toBe('chat-1');
    expect(tab.status).toBe('idle');
    expect(tab.restartCount).toBe(0);
    expect(reg.has('chat-1')).toBe(true);
  });

  test('register emits a tab.created event', () => {
    const s = createNexusState({ nexusVersion: '0.1.0', phase: 'N-1' });
    const reg = new TabRegistry(s);
    reg.register(makeSpec('chat-1'));
    expect(s.events[s.events.length - 1]).toMatchObject({ kind: 'tab.created', tabId: 'chat-1' });
  });

  test('register throws on duplicate id', () => {
    const s = createNexusState({ nexusVersion: '0.1.0', phase: 'N-1' });
    const reg = new TabRegistry(s);
    reg.register(makeSpec('chat-1'));
    expect(() => reg.register(makeSpec('chat-1'))).toThrow(/already/);
  });

  test('unregister removes the tab and emits tab.down', () => {
    const s = createNexusState({ nexusVersion: '0.1.0', phase: 'N-1' });
    const reg = new TabRegistry(s);
    reg.register(makeSpec('chat-1'));
    expect(reg.unregister('chat-1')).toBe(true);
    expect(reg.has('chat-1')).toBe(false);
    expect(s.events[s.events.length - 1]).toMatchObject({ kind: 'tab.down', tabId: 'chat-1' });
  });

  test('unregister returns false on unknown id', () => {
    const s = createNexusState({ nexusVersion: '0.1.0', phase: 'N-1' });
    const reg = new TabRegistry(s);
    expect(reg.unregister('nope')).toBe(false);
  });

  test('listByKind filters by tab kind', () => {
    const s = createNexusState({ nexusVersion: '0.1.0', phase: 'N-1' });
    const reg = new TabRegistry(s);
    reg.register(makeSpec('chat-1', 'chat'));
    reg.register(makeSpec('chat-2', 'chat'));
    reg.register(makeSpec('term-1', 'webterm'));
    expect(reg.listByKind('chat')).toHaveLength(2);
    expect(reg.listByKind('webterm')).toHaveLength(1);
    expect(reg.listByKind('daemon')).toHaveLength(0);
  });

  test('patch updates fields and leaves spec untouched', () => {
    const s = createNexusState({ nexusVersion: '0.1.0', phase: 'N-1' });
    const reg = new TabRegistry(s);
    reg.register(makeSpec('chat-1'));
    reg.patch('chat-1', { status: 'active', startedAt: 12345, pid: 99 });
    const tab = reg.get('chat-1')!;
    expect(tab.status).toBe('active');
    expect(tab.pid).toBe(99);
    expect(tab.spec.id).toBe('chat-1');
  });

  test('patch on unknown id throws', () => {
    const s = createNexusState({ nexusVersion: '0.1.0', phase: 'N-1' });
    const reg = new TabRegistry(s);
    expect(() => reg.patch('nope', { status: 'active' })).toThrow(/not found/);
  });

  test('snapshot returns plain objects safe for JSON', () => {
    const s = createNexusState({ nexusVersion: '0.1.0', phase: 'N-1' });
    const reg = new TabRegistry(s);
    reg.register(makeSpec('chat-1'));
    const snap = reg.snapshot();
    expect(snap).toHaveLength(1);
    const json = JSON.stringify(snap);
    expect(JSON.parse(json)[0].spec.id).toBe('chat-1');
  });
});
