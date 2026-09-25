import { describe, expect, test } from 'bun:test';
import {
  companionSurfaceId,
  parseCompanionSurfaceId,
} from '../src/dashboard/companion-surface-address.js';

describe('companionSurfaceId', () => {
  test('encodes owner and key into a stable surface id', () => {
    expect(companionSurfaceId('dashboard-main', 'clipboard'))
      .toBe('companion:dashboard-main::clipboard');
  });
});

describe('parseCompanionSurfaceId', () => {
  test('parses dashboard and vw owner ids', () => {
    expect(parseCompanionSurfaceId('companion:dashboard-main::memo')).toEqual({
      ownerId: 'dashboard-main',
      key: 'memo',
    });
    expect(parseCompanionSurfaceId('companion:virtual-window:12::clipboard')).toEqual({
      ownerId: 'virtual-window:12',
      key: 'clipboard',
    });
  });

  test('returns null for unrelated ids', () => {
    expect(parseCompanionSurfaceId('debug-window')).toBeNull();
  });
});
