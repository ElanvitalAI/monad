import { describe, expect, test } from 'bun:test';
import {
  resolveCompanionPopupChrome,
  resolveCompanionPopupTitleControls,
  resolveWindowScopedCompanionPopupChrome,
  resolveWindowScopedCompanionPopupStatus,
} from '../src/dashboard/modals/companion-popup-chrome.js';

describe('companion popup chrome helpers', () => {
  test('default controls include promote', () => {
    expect(resolveCompanionPopupTitleControls().map((control) => control.id)).toEqual([
      'minimize',
      'promote',
      'close',
    ]);
  });

  test('no-promote controls omit promote', () => {
    expect(resolveCompanionPopupTitleControls('no-promote').map((control) => control.id)).toEqual([
      'minimize',
      'close',
    ]);
  });

  test('resolves rounded companion chrome defaults', () => {
    expect(resolveCompanionPopupChrome({
      theme: {} as never,
      bottomStatus: 'companion · test',
    })).toMatchObject({
      variant: 'rounded',
      titleAlign: 'left',
      titlePrefix: '◌',
      bottomStatus: 'companion · test',
    });
  });

  test('preserves caller title controls when provided', () => {
    expect(resolveCompanionPopupChrome({
      theme: {} as never,
      bottomStatus: 'companion · test',
      titleControls: resolveCompanionPopupTitleControls('no-promote'),
    }).titleControls?.map((control) => control.id)).toEqual([
      'minimize',
      'close',
    ]);
  });

  test('adds window scoped status suffix', () => {
    expect(resolveWindowScopedCompanionPopupStatus('companion · test', 7)).toBe(
      'companion · test · win:7',
    );
  });

  test('resolves window scoped companion chrome', () => {
    expect(resolveWindowScopedCompanionPopupChrome({
      theme: {} as never,
      bottomStatus: 'companion · test',
      windowId: 7,
      titleControls: resolveCompanionPopupTitleControls('no-promote'),
    })).toMatchObject({
      variant: 'rounded',
      titleAlign: 'left',
      titlePrefix: '◌',
      bottomStatus: 'companion · test · win:7',
    });
  });
});
