// InteractiveModalSession-flavored `WizardIO` — dashboard widget host.
//
// Drives the wizard through the bidirectional Q&A widget framework
// (`src/expression/widget/`). Each `io.ask(prompt)` call becomes one
// step in a chain; the chain resolves with the line entered. This is
// the path the dashboard `/setup` slash uses to host the wizard
// inline (modal-lifecycle integration follow-up wires the widget into
// `coordinator.ts`).
//
// The session is single-step-at-a-time here because the legacy step
// functions issue prompts imperatively via `io.ask()`. A future PR
// can flip to multi-step `InteractiveModalSpec` chains by rewriting
// the step functions to emit `StepSpec` objects up-front.

import {
  createTestReadlineHost,
  type ReadlineHost,
  type TestReadlineHost,
} from '../expression/widget/index.js';
import type { InteractiveModalSpec } from '../expression/spec/types.js';
import type { WizardIO } from '../onboarding.js';

export interface WidgetIOOptions {
  /** Inject a custom host — defaults to a synchronous test host so
   *  callers without a dashboard framing can drive the wizard from
   *  scripted lines. Production hosts (dashboard `/setup`) inject a
   *  routed-key host hooked to modal-lifecycle. */
  host?: ReadlineHost;
  /** Callback fired for every progress event. Useful for the dashboard
   *  host to repaint the modal frame as the chain advances. */
  onProgress?: (info: { step: string; pendingAnswer?: unknown }) => void;
}

/** Build a `WizardIO` backed by `runInteractiveModalSession`. The
 *  returned IO blocks `ask()` until the host emits a matching `line`
 *  event; production hosts feed lines from routed key dispatch in
 *  the dashboard. Tests use `createTestReadlineHost()` (the default)
 *  + `host.emit({kind:'line', value:...})` to drive the queue. */
export function widgetIO(opts: WidgetIOOptions = {}): WizardIO & {
  /** The host driving this IO. When the caller didn't provide one,
   *  this is a `TestReadlineHost` (use `__host.emit({...})` to push
   *  events). Production hosts inject their own and the type widens
   *  to `ReadlineHost`. */
  __host: ReadlineHost | TestReadlineHost;
} {
  const host = opts.host ?? createTestReadlineHost();
  const outputs: string[] = [];
  const pending: Array<(line: string) => void> = [];

  // Listen for line events that arrive *outside* an active prompt.
  // We queue them so the next ask() resolves immediately if the host
  // already pushed a line.
  const linePool: string[] = [];
  host.on((ev) => {
    if (ev.kind !== 'line') return;
    if (pending.length > 0) {
      const resolve = pending.shift()!;
      resolve(ev.value);
    } else {
      linePool.push(ev.value);
    }
  });

  const askLine = (): Promise<string> =>
    new Promise<string>((resolve) => {
      if (linePool.length > 0) {
        resolve(linePool.shift()!);
        return;
      }
      pending.push(resolve);
    });

  return {
    __host: host,
    ask: async (prompt) => {
      outputs.push(prompt);
      const line = await askLine();
      opts.onProgress?.({ step: prompt, pendingAnswer: line });
      return line.trim();
    },
    askSecret: async (prompt) => {
      outputs.push(prompt);
      const line = await askLine();
      opts.onProgress?.({ step: prompt, pendingAnswer: '<secret>' });
      return line.trim();
    },
    print: (text) => {
      outputs.push(text);
    },
    close: () => {
      try {
        host.close();
      } catch { /* idempotent */ }
    },
  };
}

/** Convenience: bundle the legacy 5-step wizard inside a single
 *  `InteractiveModalSpec` for hosts that prefer the chain-spec path
 *  over the imperative `WizardIO.ask` chain. The renderer (next
 *  follow-up PR) consumes this directly without going through the
 *  step functions. */
export function buildWizardSpec(
  steps: ReadonlyArray<{ id: string; label: string; secret?: boolean }>,
): InteractiveModalSpec {
  return {
    kind: 'interactive-modal',
    id: 'elanous-setup-wizard',
    title: 'elanous — setup wizard',
    excerpt: 'Configure provider · skills · vault · bots',
    steps: steps.map((s) => ({
      kind: 'text',
      id: s.id,
      label: s.label,
      secret: s.secret,
    })),
  };
}
