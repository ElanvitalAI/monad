// PWA · queryKey + invalidation tests (Phase N-4 PR ξ)

import { describe, test, expect } from 'bun:test';
import { nexusKeys, invalidationsForEvent, eventInvalidationMap } from './query-keys';

describe('nexusKeys factories', () => {
  test('all keys live under ["nexus"] root', () => {
    for (const make of [
      () => nexusKeys.health(),
      () => nexusKeys.snapshot(),
      () => nexusKeys.tabs(),
      () => nexusKeys.tab('chat:1'),
      () => nexusKeys.templates(),
      () => nexusKeys.template('voice'),
      () => nexusKeys.config(),
      () => nexusKeys.switches(),
      () => nexusKeys.switch('global.tools'),
      () => nexusKeys.secrets(),
      () => nexusKeys.bindingChannels(),
      () => nexusKeys.bindings('pushcut'),
      () => nexusKeys.binding('pushcut', 'token-x'),
      () => nexusKeys.logsTail('d:1'),
    ]) {
      expect(make()[0]).toBe('nexus');
    }
  });

  test('tabs(kind) emits filter object', () => {
    const k = nexusKeys.tabs('chat');
    expect(k).toEqual(['nexus', 'tabs', { kind: 'chat' }]);
  });

  test('tabs() without kind omits the filter', () => {
    expect(nexusKeys.tabs()).toEqual(['nexus', 'tabs']);
  });

  test('tab(id) carries id at tail', () => {
    expect(nexusKeys.tab('chat:1')[2]).toBe('chat:1');
  });

  test('binding(channel, key) is composite + distinct from bindings(channel)', () => {
    expect(nexusKeys.binding('pushcut', 'k1')).toEqual(['nexus', 'binding', 'pushcut', 'k1']);
    expect(nexusKeys.bindings('pushcut')).toEqual(['nexus', 'bindings', 'pushcut']);
  });

  test('logsTail(id, lines) emits filter when lines provided', () => {
    expect(nexusKeys.logsTail('d:1', 100)).toEqual(['nexus', 'logs', 'd:1', { lines: 100 }]);
    expect(nexusKeys.logsTail('d:1')).toEqual(['nexus', 'logs', 'd:1']);
  });
});

describe('eventInvalidationMap + invalidationsForEvent', () => {
  test('tab.* events invalidate snapshot + tabs', () => {
    const keys = invalidationsForEvent('tab.up');
    expect(keys).toContainEqual(nexusKeys.snapshot());
    expect(keys).toContainEqual(nexusKeys.tabs());
  });

  test('nexus.* events invalidate health + snapshot', () => {
    const keys = invalidationsForEvent('nexus.boot');
    expect(keys).toContainEqual(nexusKeys.health());
    expect(keys).toContainEqual(nexusKeys.snapshot());
  });

  test('config.changed invalidates config + switches', () => {
    const keys = invalidationsForEvent('config.changed');
    expect(keys).toContainEqual(nexusKeys.config());
    expect(keys).toContainEqual(nexusKeys.switches());
  });

  test('unknown prefix returns empty (no spurious invalidation)', () => {
    expect(invalidationsForEvent('mystery.event')).toEqual([]);
  });

  test('eventInvalidationMap entries are stable / non-empty', () => {
    expect(Object.keys(eventInvalidationMap).length).toBeGreaterThanOrEqual(3);
    for (const [, keys] of Object.entries(eventInvalidationMap)) {
      expect(Array.isArray(keys)).toBe(true);
      expect(keys.length).toBeGreaterThan(0);
    }
  });
});
