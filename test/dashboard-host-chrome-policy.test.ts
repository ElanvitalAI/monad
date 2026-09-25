import { describe, expect, test } from 'bun:test';

import {
  defaultVirtualWindowBoundsForHostChrome,
  reservedBottomRowsForHostChrome,
  resolveDashboardHostChromePolicy,
} from '../src/dashboard/host-chrome-policy.js';

describe('dashboard host chrome policy', () => {
  test('blocking popup above main suppresses prompt/status but preserves main background', () => {
    const policy = resolveDashboardHostChromePolicy({
      foregroundSurface: null,
      blockingForegroundModal: {} as any,
      bottomAreaFreezeModal: null,
    });
    expect(policy.suppressHudArea).toBe(true);
    expect(policy.suppressPromptArea).toBe(true);
    expect(policy.suppressStatusArea).toBe(true);
    expect(policy.suppressDashboardBackground).toBe(false);
    expect(policy.suppressDockArea).toBe(false);
    expect(policy.fixedDockRows).toBe(2);
    expect(policy.reservedBottomRows).toBe(2);
    expect(policy.foregroundHostChromeProfile).toBe('dock-only');
  });

  test('full host chrome profile keeps hud status and prompt visible while reserving extra rows', () => {
    const policy = resolveDashboardHostChromePolicy({
      foregroundSurface: { hostChromeProfile: 'hud-status-input-dock' } as any,
      blockingForegroundModal: { hostChromeProfile: 'hud-status-input-dock' } as any,
      bottomAreaFreezeModal: null,
    });
    expect(policy.suppressHudArea).toBe(false);
    expect(policy.suppressPromptArea).toBe(false);
    expect(policy.suppressStatusArea).toBe(false);
    expect(policy.suppressDashboardBackground).toBe(true);
    expect(policy.suppressDockArea).toBe(false);
    expect(policy.fixedDockRows).toBe(2);
    expect(policy.reservedBottomRows).toBe(9);
    expect(policy.foregroundHostChromeProfile).toBe('hud-status-input-dock');
  });

  test('workspace foreground can widen reserved host chrome rows without counting as a blocking modal', () => {
    const policy = resolveDashboardHostChromePolicy({
      foregroundSurface: { hostChromeProfile: 'hud-status-input-dock' } as any,
      blockingForegroundModal: null,
      bottomAreaFreezeModal: null,
    });
    expect(policy.suppressHudArea).toBe(false);
    expect(policy.suppressPromptArea).toBe(false);
    expect(policy.suppressStatusArea).toBe(false);
    expect(policy.suppressDashboardBackground).toBe(true);
    expect(policy.reservedBottomRows).toBe(9);
    expect(policy.foregroundHostChromeProfile).toBe('hud-status-input-dock');
  });

  test('dock-only workspace foreground suppresses prompt and status by default', () => {
    const policy = resolveDashboardHostChromePolicy({
      foregroundSurface: { hostChromeProfile: 'dock-only', interactionClass: 'workspace' } as any,
      blockingForegroundModal: null,
      bottomAreaFreezeModal: null,
    });
    expect(policy.suppressPromptArea).toBe(true);
    expect(policy.suppressStatusArea).toBe(true);
    expect(policy.suppressDockArea).toBe(false);
    expect(policy.foregroundHostChromeProfile).toBe('dock-only');
  });

  test('blocking popup above a workspace keeps the workspace host chrome profile for reserve', () => {
    const policy = resolveDashboardHostChromePolicy({
      foregroundSurface: { hostChromeProfile: 'hud-status-input-dock' } as any,
      blockingForegroundModal: { hostChromeProfile: 'dock-only' } as any,
      bottomAreaFreezeModal: null,
    });
    expect(policy.foregroundHostChromeProfile).toBe('hud-status-input-dock');
    expect(policy.reservedBottomRows).toBe(9);
    expect(policy.suppressDashboardBackground).toBe(true);
  });

  test('blocking popup above dock-only workspace still suppresses the workspace background', () => {
    const policy = resolveDashboardHostChromePolicy({
      foregroundSurface: { hostChromeProfile: 'dock-only', interactionClass: 'workspace' } as any,
      blockingForegroundModal: { hostChromeProfile: 'dock-only' } as any,
      bottomAreaFreezeModal: null,
    });
    expect(policy.suppressPromptArea).toBe(true);
    expect(policy.suppressStatusArea).toBe(true);
    expect(policy.suppressDashboardBackground).toBe(true);
  });

  test('dock-only blocking popup does not suppress prompt and status by foreground profile alone', () => {
    const policy = resolveDashboardHostChromePolicy({
      foregroundSurface: { hostChromeProfile: 'dock-only', interactionClass: 'blocking-modal' } as any,
      blockingForegroundModal: null,
      bottomAreaFreezeModal: null,
    });
    expect(policy.suppressPromptArea).toBe(false);
    expect(policy.suppressStatusArea).toBe(false);
    expect(policy.suppressDashboardBackground).toBe(false);
  });

  test('default VW bounds reserve the fixed dock rows', () => {
    expect(defaultVirtualWindowBoundsForHostChrome(
      { cols: 120, rows: 30 },
      { fixedDockRows: 2 },
    )).toEqual({
      row: 1,
      col: 1,
      width: 120,
      height: 28,
    });
  });

  test('full host chrome reserve uses hud + prompt/status/dock rows', () => {
    expect(reservedBottomRowsForHostChrome('hud-status-input-dock')).toBe(9);
    expect(defaultVirtualWindowBoundsForHostChrome(
      { cols: 120, rows: 30 },
      { reservedBottomRows: reservedBottomRowsForHostChrome('hud-status-input-dock') },
    )).toEqual({
      row: 1,
      col: 1,
      width: 120,
      height: 21,
    });
  });
});
