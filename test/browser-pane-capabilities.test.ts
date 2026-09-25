import { describe, expect, test } from 'bun:test';

import {
  resolveBrowserCapabilityMatrix,
  resolveBrowserTransferCapability,
} from '../src/browser-pane/capabilities.js';
import { createBrowserPaneModel } from '../src/browser-pane/model.js';
import type { TransferTarget } from '../src/transfer/transfer-targets.js';

const TARGETS: TransferTarget[] = [
  {
    kind: 'ssh',
    name: 'mba',
    host: { name: 'mba', host: 'mba' },
    remoteDir: '~/Downloads/',
  },
];

describe('browser pane capability matrix', () => {
  test('local browser keeps drag/copy/transfer enabled', () => {
    const browser = createBrowserPaneModel('/tmp');
    expect(resolveBrowserCapabilityMatrix(browser)).toEqual({
      dragEnabled: true,
      copyPathEnabled: true,
      transferEnabled: true,
    });
  });

  test('remote browser disables drag and transfer but keeps copy-path', () => {
    const browser = createBrowserPaneModel('/tmp');
    browser.remote = {
      host: { name: 'mba', host: 'mba' },
      cwd: '/remote',
    };
    expect(resolveBrowserCapabilityMatrix(browser)).toEqual({
      dragEnabled: false,
      copyPathEnabled: true,
      transferEnabled: false,
    });
  });

  test('transfer capability returns targets for local browser', () => {
    const browser = createBrowserPaneModel('/tmp');
    const result = resolveBrowserTransferCapability(browser, TARGETS);
    expect(result.enabled).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.targets).toEqual(TARGETS);
  });

  test('transfer capability rejects remote browser instances', () => {
    const browser = createBrowserPaneModel('/tmp');
    browser.remote = {
      host: { name: 'mba', host: 'mba' },
      cwd: '/remote',
    };
    const result = resolveBrowserTransferCapability(browser, TARGETS);
    expect(result.enabled).toBe(false);
    expect(result.targets).toEqual([]);
    expect(result.reason).toContain('remote browser');
  });
});
