// ── External-terminal VW pane (NT-C1b-4) ──
//
// VW PaneContent that renders a PreviewTerminal whose lifecycle is
// owned by someone else (the RunnerHostFactory, specifically). Lets
// the shell-runner keep a persistent PTY alive across sequential
// commands while the VW subsystem handles rendering, focus, and
// user keyboard routing.
//
// Key differences from 'terminal' pane:
//   • Does NOT call preview.start() or preview.stop() — caller owns.
//   • Honors focusPolicy:
//       - 'interactive'  : forwards every key byte, like the legacy
//                           terminal pane.
//       - 'output-only'  : swallows normal keys. Only the three
//                           INTERRUPT_CHORDS (Ctrl+C / Ctrl+D /
//                           Ctrl+\\) pass through so the user can
//                           still stop a runaway command without
//                           explicitly focusing this pane.
//   • `dispose()` is a no-op — the factory disposes the PTY on its
//     own schedule.

import type { PreviewTerminal } from '../preview/terminal.js';
import type { PaneContent, PaneEventKind } from '../virtual-windows/pane-content.js';
import type { FocusPolicy } from './types.js';
import { INTERRUPT_CHORDS } from './types.js';
import { keyEventToTerminalBytes } from '../display/execution-surface.js';
import { isPtyForwardMouseEventType, type DisplayMouseEvent } from '../display/types.js';
import { classifyVwTerminalExposure } from '../terminal/posture.js';
import { resolveTerminalInteractionPolicy } from '../terminal/tui-policy.js';

export interface ExternalTerminalPaneOpts {
  title?: string;
  preview: PreviewTerminal;
  focusPolicy?: FocusPolicy;
  /** Label displayed in pane title-bar / registry entries. */
  label?: string;
  /** Host-side terminal surface intent seam. Preserves double-click /
   * motion intent even when the child PTY transport cannot consume it. */
  onTerminalMouseIntent?: (ev: DisplayMouseEvent, meta: {
    paneId: string;
    paneKind: 'external-terminal';
    exposure: ReturnType<typeof classifyVwTerminalExposure>;
    interactionPolicy: ReturnType<typeof resolveTerminalInteractionPolicy>;
  }) => void;
}

/** Pane id minter — matches the format used by pane-content.ts so
 *  registry bookkeeping stays consistent. */
let paneCounter = 0;
function mintPaneId(): string {
  return `pane:ext-${++paneCounter}`;
}

export function createExternalTerminalPaneContent(
  opts: ExternalTerminalPaneOpts,
): PaneContent {
  const id = mintPaneId();
  const { preview } = opts;
  let policy: FocusPolicy = opts.focusPolicy ?? 'output-only';
  const subscribers = new Map<PaneEventKind, Set<(p?: unknown) => void>>();

  const interactionPolicy = () => resolveTerminalInteractionPolicy(
    classifyVwTerminalExposure(policy, preview.isAlive ? 'running' : 'completed'),
  );

  const forwardByte = (bytes: string): boolean => {
    switch (interactionPolicy().keyboardParticipation) {
      case 'full':
        preview.write(bytes);
        return true;
      case 'interrupt-only':
        if (
          bytes === INTERRUPT_CHORDS.ctrlC ||
          bytes === INTERRUPT_CHORDS.ctrlD ||
          bytes === INTERRUPT_CHORDS.ctrlBackslash
        ) {
          preview.write(bytes);
          return true;
        }
        return false;
      case 'none':
        return false;
    }
  };

  const pane: PaneContent & {
    readonly focusPolicy: FocusPolicy;
    setFocusPolicy: (next: FocusPolicy) => FocusPolicy;
  } = {
    id,
    kind: 'external-terminal',
    title: opts.title ?? opts.label ?? 'runner',
    start() { /* host-owned; caller ensured preview.start() */ },
    stop() { /* no-op — external lifecycle */ },
    render(ctx) {
      try {
        preview.resize(Math.max(2, ctx.cols), Math.max(2, ctx.rows));
      } catch { /* ignore resize races */ }
      return preview.render(ctx.focused);
    },
    onKey(ev) {
      const bytes = keyEventToTerminalBytes(ev);
      if (!bytes) return { type: 'none' };
      const accepted = forwardByte(bytes);
      return accepted ? { type: 'refresh' } : { type: 'none' };
    },
    onMouse(ev) {
      const exposure = classifyVwTerminalExposure(policy, preview.isAlive ? 'running' : 'completed');
      const interaction = resolveTerminalInteractionPolicy(exposure);
      if (interaction.hostMouseIntentVisible) {
        opts.onTerminalMouseIntent?.(ev, {
          paneId: id,
          paneKind: 'external-terminal',
          exposure,
          interactionPolicy: interaction,
        });
      }
      if (interaction.mouseTransport === 'none') return { type: 'none' };
      // Focus-grabbing discrete clicks are honored even for observe-only
      // panes; richer mouse transport remains reserved for full
      // user-interactive posture.
      if (interaction.mouseTransport === 'discrete-only') {
        if (ev.type !== 'click' && ev.type !== 'right-click') return { type: 'none' };
        try { preview.forwardMouse({ type: ev.type, row: ev.row, col: ev.col }); } catch { /* ignore */ }
        return { type: 'refresh' };
      }
      // IDX-F5d — double-click has no SGR 1006 representation (widget-
      // synthesized); motion is a widget-level hover signal that the
      // child PTY doesn't want either.
      if (!isPtyForwardMouseEventType(ev.type)) return { type: 'none' };
      try { preview.forwardMouse({ type: ev.type, row: ev.row, col: ev.col }); } catch { /* ignore */ }
      return { type: 'refresh' };
    },
    write(bytes) {
      forwardByte(bytes);
    },
    capture() {
      try { return preview.render(false); } catch { return ''; }
    },
    get isAlive() { return preview.isAlive; },
    on(event, cb) {
      let set = subscribers.get(event);
      if (!set) { set = new Set(); subscribers.set(event, set); }
      set.add(cb);
      return () => { set!.delete(cb); };
    },
    dispose() { /* external lifecycle — do NOT stop the PTY */ },
    get focusPolicy() { return policy; },
    setFocusPolicy(next) {
      const prev = policy;
      policy = next;
      return prev;
    },
  };

  return pane;
}
