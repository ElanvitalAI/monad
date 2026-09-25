// Widget routing — PaneKeyRouter factory.
//
// The dispatcher that replaces dashboard.ts's 28-branch if-chain. Pure
// Map lookup + delegation to the registered handler closure. See
// ./types.ts for the contract.

import type { Key } from '../tui.js';
import { debug } from '../debug/log.js';
import type { KeyRouterResult, PaneHandler, PaneKeyRouter } from './types.js';

export function createPaneKeyRouter(): PaneKeyRouter {
  const handlers = new Map<string, PaneHandler>();

  return {
    register(paneId, handler) {
      if (handlers.has(paneId) && debug.enabled) {
        // Registering twice for the same pane is almost always a bug
        // during Phase 0 extraction (we want a 1:1 with the legacy
        // inline branches). Log loudly so the next session catches it
        // from log/debug-*.log alone per the project's debug
        // instrumentation rule.
        debug.log('widget-routing.register.replace', paneId, {
          previous: 'present',
        });
      }
      handlers.set(paneId, handler);
    },

    async dispatch(paneId, key): Promise<KeyRouterResult> {
      const handler = handlers.get(paneId);
      if (!handler) {
        if (debug.enabled) {
          debug.log('widget-routing.dispatch.missing', paneId, {
            key: key.name || '(empty)',
          });
        }
        return 'passthrough';
      }
      const result = await handler(key);
      if (debug.enabled) {
        debug.log('widget-routing.dispatch', paneId, {
          key: key.name || '(empty)',
          result,
          ctrl: key.ctrl,
          shift: key.shift,
        });
      }
      return result;
    },

    registered() {
      return Array.from(handlers.keys());
    },

    has(paneId) {
      return handlers.has(paneId);
    },
  };
}
