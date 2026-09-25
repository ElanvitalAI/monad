import { describe, expect, test } from 'bun:test';
import {
  resolvePaneMultiLiveSnapshotChrome,
  resolvePaneMultiModalChrome,
  resolvePaneMultiLiveSnapshotStatus,
  resolvePaneMultiModalTitleControls,
} from '../src/dashboard/modals/pane-multi-chrome.js';

describe('pane multi chrome helpers', () => {
  test('close-only controls expose only close', () => {
    expect(resolvePaneMultiModalTitleControls('close-only')).toEqual([
      { id: 'close', label: '✕' },
    ]);
  });

  test('model-close controls expose model then close', () => {
    expect(resolvePaneMultiModalTitleControls('model-close')).toEqual([
      { id: 'model', label: '⌥' },
      { id: 'close', label: '✕' },
    ]);
  });

  test('minimize-close controls expose minimize then close', () => {
    expect(resolvePaneMultiModalTitleControls('minimize-close')).toEqual([
      { id: 'minimize', label: '—' },
      { id: 'close', label: '✕' },
    ]);
  });

  test('resolvePaneMultiModalChrome preserves rounded defaults', () => {
    expect(resolvePaneMultiModalChrome({
      theme: {} as never,
      titlePrefix: '⠿',
      titleControls: resolvePaneMultiModalTitleControls('close-only'),
      bottomStatus: 'browser · live',
    })).toMatchObject({
      variant: 'rounded',
      titleAlign: 'left',
      titlePrefix: '⠿',
      bottomStatus: 'browser · live',
    });
  });

  test('resolves canonical live snapshot status text', () => {
    expect(resolvePaneMultiLiveSnapshotStatus('browser', true)).toBe('browser · live');
    expect(resolvePaneMultiLiveSnapshotStatus('preview', false)).toBe('preview · snapshot');
    expect(resolvePaneMultiLiveSnapshotStatus('browser · preview', true)).toBe('browser · preview · live');
  });

  test('builds live snapshot chrome from subject and control mode', () => {
    expect(resolvePaneMultiLiveSnapshotChrome({
      theme: {} as never,
      titlePrefix: '⠿',
      controlMode: 'model-close',
      subject: 'browser · preview',
      liveMode: true,
    })).toMatchObject({
      variant: 'rounded',
      titleAlign: 'left',
      titlePrefix: '⠿',
      bottomStatus: 'browser · preview · live',
    });
  });
});
