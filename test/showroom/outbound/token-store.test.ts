// W7 Z11.a-1 · in-memory token store CRUD + prune.

import { describe, expect, test } from 'bun:test';
import { InMemoryDeviceTokenStore } from '../../../src/showroom/outbound/token-store';

describe('InMemoryDeviceTokenStore', () => {
  test('upsert + count + list', () => {
    const s = new InMemoryDeviceTokenStore();
    expect(s.count('ios-push')).toBe(0);
    s.upsert({ channel: 'ios-push', deviceId: 'd1', token: 't1', registeredAt: 100 });
    s.upsert({ channel: 'ios-push', deviceId: 'd2', token: 't2', registeredAt: 200 });
    s.upsert({ channel: 'live-activity', deviceId: 'd1', token: 'la1', registeredAt: 150 });
    expect(s.count('ios-push')).toBe(2);
    expect(s.count('live-activity')).toBe(1);
    expect(s.list('ios-push').map((r) => r.deviceId).sort()).toEqual(['d1', 'd2']);
  });

  test('upsert replaces existing token for same (channel, deviceId)', () => {
    const s = new InMemoryDeviceTokenStore();
    s.upsert({ channel: 'ios-push', deviceId: 'd1', token: 't1', registeredAt: 100 });
    s.upsert({ channel: 'ios-push', deviceId: 'd1', token: 't1-new', registeredAt: 200 });
    expect(s.count('ios-push')).toBe(1);
    expect(s.list('ios-push')[0]!.token).toBe('t1-new');
  });

  test('delete removes existing record', () => {
    const s = new InMemoryDeviceTokenStore();
    s.upsert({ channel: 'ios-push', deviceId: 'd1', token: 't1', registeredAt: 100 });
    expect(s.delete('ios-push', 'd1')).toBe(true);
    expect(s.delete('ios-push', 'd1')).toBe(false);
    expect(s.count('ios-push')).toBe(0);
  });

  test('prune removes records older than threshold', () => {
    const s = new InMemoryDeviceTokenStore();
    s.upsert({ channel: 'ios-push', deviceId: 'd1', token: 't1', registeredAt: 100 });
    s.upsert({ channel: 'ios-push', deviceId: 'd2', token: 't2', registeredAt: 500 });
    expect(s.prune(300)).toBe(1);
    expect(s.list('ios-push').map((r) => r.deviceId)).toEqual(['d2']);
  });
});
