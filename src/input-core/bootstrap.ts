// input-core bootstrap — called once from dashboard.ts startup to
// seed the action registry with the reserved action ids (so LLM
// introspection has entries to enumerate) and to install any module-
// owned default bindings.
//
// Phase 2: bootstrap registers the four reserved action ids with
// no-op handlers. Real handlers for these are wired in later phases
// (app.interrupt in Phase 8 migration, modal.* in Phase 4, etc.).
//
// This module is deliberately small and idempotent — callers may
// invoke it multiple times without breakage. Used by tests to reset
// the registry before exercising a scenario.

import { registerAction } from './actions.js';
import { registerBuiltInModes } from './mode.js';

let bootstrapped = false;

export function bootstrapInputCore(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  // Register general / sync / control modes with no-op handlers.
  // Concrete implementations (src/sync.ts + src/chat-mode.ts) override
  // these via registerMode() at their own bootstrap.
  registerBuiltInModes();

  // Reserved actions — placeholders so GetInputPolicy() can list
  // them. Actual handlers for each live in the dashboard's existing
  // dispatch paths (Ctrl+C interrupt, Ctrl+Q quit, Esc cancel, Enter
  // submit). Phase 8 migrates those inline branches through these
  // actions; today the handler is a noop because the legacy path
  // owns the behaviour.
  registerAction({
    id: 'app.interrupt',
    description: 'Interrupt the current operation (Ctrl+C).',
    handler: () => {},
    reserved: true,
    allowOverwrite: true,
  });
  registerAction({
    id: 'app.quit',
    description: 'Quit monad.',
    handler: () => {},
    reserved: true,
    allowOverwrite: true,
  });
  registerAction({
    id: 'modal.cancel',
    description: 'Cancel the foreground modal (Esc).',
    handler: () => {},
    reserved: true,
    allowOverwrite: true,
  });
  registerAction({
    id: 'modal.submit',
    description: 'Submit the foreground modal (Enter).',
    handler: () => {},
    reserved: true,
    allowOverwrite: true,
  });
}

/** Test helper — allow re-bootstrap after a registry reset. */
export function __resetBootstrapFlagForTests(): void {
  bootstrapped = false;
}
