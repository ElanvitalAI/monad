import type { BrowserPaneModel } from './model.js';
import type { TransferTarget } from '../transfer/transfer-targets.js';

export interface BrowserCapabilityMatrix {
  dragEnabled: boolean;
  copyPathEnabled: boolean;
  transferEnabled: boolean;
}

export interface BrowserTransferCapability {
  enabled: boolean;
  targets: TransferTarget[];
  reason: string | null;
}

export function resolveBrowserCapabilityMatrix(
  browser: Pick<BrowserPaneModel, 'remote'>,
): BrowserCapabilityMatrix {
  if (browser.remote) {
    return {
      dragEnabled: false,
      copyPathEnabled: true,
      transferEnabled: false,
    };
  }
  return {
    dragEnabled: true,
    copyPathEnabled: true,
    transferEnabled: true,
  };
}

export function resolveBrowserTransferCapability(
  browser: Pick<BrowserPaneModel, 'remote'>,
  targets: readonly TransferTarget[],
): BrowserTransferCapability {
  const matrix = resolveBrowserCapabilityMatrix(browser);
  if (!matrix.transferEnabled) {
    return {
      enabled: false,
      targets: [],
      reason: 'transfer is disabled for remote browser instances',
    };
  }
  return {
    enabled: true,
    targets: [...targets],
    reason: null,
  };
}
