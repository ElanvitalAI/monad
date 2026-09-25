// F-B1 — Fake harness for unit tests.
//
// Tests drive the scenario runner against this in-memory harness;
// no real terminal, coordinator, or modal stack involved. Every
// mutation updates plain-object state, every query reads it back.
//
// F-B2 will add `LiveHarness` that implements the same interface
// against the running DisplayCoordinator + playground-widget.
// The runner doesn't know the difference.

import type {
  ClickTarget,
  MountSpec,
  PlaygroundHarness,
} from './types.js';
import type { KeyEvent } from '../plugins/core/types.js';
import type { ContextKeys } from '../input-core/context-keys.js';

export interface FakeHarnessState {
  modalStack: string[];
  lastClickedComponentId: string | null;
  lastRender: string;
  theme: string;
  contextKeys: Partial<ContextKeys>;
  /** Event log — tests can inspect the ordered sequence of
   *  interactions to catch ordering bugs that simple status
   *  checks miss. */
  events: FakeEvent[];
}

export type FakeEvent =
  | { type: 'mount'; id: string }
  | { type: 'dismiss'; id: string | null }
  | { type: 'click'; target: ClickTarget; button: 'left' | 'right' | 'double' }
  | { type: 'key'; event: KeyEvent }
  | { type: 'theme'; name: string }
  | { type: 'context-key'; key: string; value: unknown };

export function createFakeHarness(initial: Partial<FakeHarnessState> = {}): {
  harness: PlaygroundHarness;
  state: FakeHarnessState;
} {
  const state: FakeHarnessState = {
    modalStack: initial.modalStack ?? [],
    lastClickedComponentId: initial.lastClickedComponentId ?? null,
    lastRender: initial.lastRender ?? '',
    theme: initial.theme ?? 'default',
    contextKeys: { ...(initial.contextKeys ?? {}) },
    events: initial.events ? [...initial.events] : [],
  };

  const harness: PlaygroundHarness = {
    mount(spec: MountSpec): void {
      state.modalStack.push(spec.id);
      state.events.push({ type: 'mount', id: spec.id });
      // Minimal synthetic render for tests that assert on
      // render-contains. Real harness paints actual ANSI.
      state.lastRender = `[mounted:${spec.id}:${spec.kind}] ` + state.lastRender;
    },
    dismiss(modalId?: string): void {
      if (modalId) {
        const idx = state.modalStack.lastIndexOf(modalId);
        if (idx >= 0) state.modalStack.splice(idx, 1);
        state.events.push({ type: 'dismiss', id: modalId });
      } else {
        const popped = state.modalStack.pop() ?? null;
        state.events.push({ type: 'dismiss', id: popped });
      }
    },
    click(target: ClickTarget, button: 'left' | 'right' | 'double'): void {
      if (target.kind === 'component') {
        state.lastClickedComponentId = target.componentId;
      }
      state.events.push({ type: 'click', target, button });
    },
    key(event: KeyEvent): void {
      state.events.push({ type: 'key', event });
    },
    setTheme(name: string): void {
      state.theme = name;
      state.events.push({ type: 'theme', name });
    },
    setContextKey(key, value): void {
      (state.contextKeys as Record<string, unknown>)[key as string] = value;
      state.events.push({ type: 'context-key', key: String(key), value });
    },
    getContextKey(key) {
      return state.contextKeys[key] as never;
    },
    getModalStack(): string[] {
      return [...state.modalStack];
    },
    getLastClickedComponentId(): string | null {
      return state.lastClickedComponentId;
    },
    getLastRender(): string {
      return state.lastRender;
    },
    async waitFor(_ms: number): Promise<void> {
      // Fake harness doesn't implement real timers — no-op so
      // scenarios with WaitStep still run deterministically.
    },
  };

  return { harness, state };
}
