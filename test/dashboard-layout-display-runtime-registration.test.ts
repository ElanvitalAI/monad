import { describe, expect, test } from 'bun:test';

import { registerDashboardLayoutDisplayRuntimes } from '../src/dashboard/layout-display-runtime-registration.js';

describe('registerDashboardLayoutDisplayRuntimes', () => {
  test('registers layout and display-control runtimes from shared dashboard deps', () => {
    const layoutCalls: unknown[] = [];
    const displayCalls: unknown[] = [];
    const windowRegistry = { kind: 'window-registry' };
    const artifactStore = { kind: 'artifact-store' };
    const coordinator = { kind: 'display-coordinator' };
    const mouseDispatch = () => true;
    const menuProviderRegistry = { kind: 'menu-provider-registry' };
    const contextMenuRegistry = { kind: 'context-menu-registry' };
    const tooltipResolver = () => null;

    registerDashboardLayoutDisplayRuntimes({
      windowRegistry: windowRegistry as never,
      artifactStore: artifactStore as never,
      coordinator: coordinator as never,
      mouseDispatch: mouseDispatch as never,
      menuProviderRegistry: menuProviderRegistry as never,
      contextMenuRegistry: contextMenuRegistry as never,
      tooltipResolver: tooltipResolver as never,
      registerLayout: ((registry, opts) => { layoutCalls.push({ registry, opts }); }) as never,
      registerDisplayControl: ((opts) => { displayCalls.push(opts); }) as never,
    });

    expect(layoutCalls).toEqual([{
      registry: windowRegistry,
      opts: { artifactStore },
    }]);
    expect(displayCalls).toEqual([{
      coordinator,
      mouseDispatch,
      menuProviderRegistry,
      contextMenuRegistry,
      tooltipResolver,
    }]);
  });
});
