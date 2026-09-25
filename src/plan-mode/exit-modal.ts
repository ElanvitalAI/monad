// Plan-mode exit 3-way modal — Phase WF4 (LC12 refactor).
//
// External contract unchanged — `createPlanExitModal(spec)` still
// returns a PlanExitModalHandle { surface, promise, handleKey,
// dispose }. Internals flipped onto the LC6+ View widgets:
//   - SelectView (3 choices with shortcut letters i/n/c)
//   - TextArea  (read-only plan body preview, j/k/PgUp/PgDn scroll)
//   - LinearLayout.vertical + BoxView(title) for framing
//   - mountViewAsModalSurface to speak the ModalSurface protocol
//
// Keeping the external API byte-stable lets `tool-exit.ts` and the
// existing test suite remain untouched.

import type { ModalSurface, ModalBounds } from '../display/modal-stack.js';
import type { KeyEvent } from '../display/types.js';
import { Consumed, Ignored, BoxView, type EventResult, type FocusSource, type Size, type View } from '../ui/view.js';
import type { Printer } from '../ui/printer.js';
import { LinearLayout } from '../ui/layout/linear.js';
import { SelectView } from '../ui/widgets/select-view.js';
import { TextArea } from '../ui/widgets/text-area.js';
import { mountViewAsModalSurface } from '../ui/modal-adapter.js';
import { resolveWidgetChromeBoxViewOptions } from '../ui/declarative/index.js';
import { resolveModalDialogChromeSpec } from '../ui/chrome/dialog-chrome.js';
import { renderPlanBodyMarkdown } from '../display/markdown-light.js';

export type PlanExitChoice = 'implement' | 'goal-loop' | 'handoff' | 'cancel';

export interface PlanExitModalSpec {
  id: string;
  bounds: ModalBounds;
  title: string;
  planBody: string;
  /** Wave P3b · A6-1 — optional external editor handoff. When the
   *  operator presses Ctrl-E inside the modal, the dialog awaits this
   *  callback. A non-null return body replaces the preview's text in
   *  place; null means "edit cancelled" and the preview stays as-is.
   *  Omitting the callback disables the binding gracefully. */
  onRequestExternalEdit?: () => Promise<string | null>;
  /** Notify the caller after the preview body is replaced via Ctrl-E.
   *  tool-exit.ts uses this to refresh its cached planBody so the
   *  follow-up `handoff` decision passes the edited body downstream. */
  onPlanBodyUpdated?: (next: string) => void;
}

export interface PlanExitModalHandle {
  surface: ModalSurface;
  promise: Promise<PlanExitChoice>;
  handleKey(ev: KeyEvent): 'consumed' | 'passthrough';
  dispose(choice?: PlanExitChoice): void;
}

export function createPlanExitModal(spec: PlanExitModalSpec): PlanExitModalHandle {
  let resolved = false;
  let resolver: ((v: PlanExitChoice) => void) | null = null;
  const promise = new Promise<PlanExitChoice>(r => { resolver = r; });
  const resolve = (choice: PlanExitChoice): void => {
    if (resolved) return;
    resolved = true;
    resolver?.(choice);
  };

  const view = new PlanExitDialog(spec.title, spec.planBody, resolve, {
    ...(spec.onRequestExternalEdit ? { onRequestExternalEdit: spec.onRequestExternalEdit } : {}),
    ...(spec.onPlanBodyUpdated ? { onPlanBodyUpdated: spec.onPlanBodyUpdated } : {}),
  });
  const mounted = mountViewAsModalSurface({
    id: spec.id,
    bounds: spec.bounds,
    view,
    priority: 250,
    tier: 'dialog',
  });

  const dispose = (choice?: PlanExitChoice): void => {
    resolve(choice ?? 'cancel');
    mounted.dispose();
  };

  return { surface: mounted.surface, promise, handleKey: mounted.handleKey, dispose };
}

// ── Internal composite View ────────────────────────────────────

export interface PlanExitDialogOpts {
  onRequestExternalEdit?: () => Promise<string | null>;
  onPlanBodyUpdated?: (next: string) => void;
}

export class PlanExitDialog implements View {
  private preview: TextArea;
  private choices: SelectView<PlanExitChoice>;
  private root: View;
  private readonly onRequestExternalEdit?: () => Promise<string | null>;
  private readonly onPlanBodyUpdated?: (next: string) => void;
  private editInFlight = false;

  constructor(
    title: string,
    planBody: string,
    resolve: (c: PlanExitChoice) => void,
    opts: PlanExitDialogOpts = {},
  ) {
    // Wave B (presentation) · A6-1 follow-up — render plan body
    // through the lightweight markdown helper so headings / lists /
    // inline emphasis appear styled. Raw body is preserved by the
    // upstream `planBody` capture in tool-exit.ts (used for
    // implement / handoff payloads), so this transform is purely
    // presentational.
    this.preview = new TextArea({
      text: renderPlanBodyMarkdown(planBody),
      readOnly: true,
      wrap: true,
    });
    this.preview.takeFocus();
    if (opts.onRequestExternalEdit) this.onRequestExternalEdit = opts.onRequestExternalEdit;
    if (opts.onPlanBodyUpdated) this.onPlanBodyUpdated = opts.onPlanBodyUpdated;

    const editHint = this.onRequestExternalEdit ? ' · ^E edit' : '';
    this.choices = new SelectView<PlanExitChoice>({
      options: [
        { value: 'implement', label: 'Implement now',       shortcut: 'i',
          description: 'Drop plan-mode gate, continue here' },
        { value: 'goal-loop', label: 'Goal-loop drive',     shortcut: 'g',
          description: 'Convert plan → /goal + auto-continuation (Ralph loop)' },
        { value: 'handoff',   label: 'Save + new session',  shortcut: 'n',
          description: 'Persist plan, /compact handoff' },
        { value: 'cancel',    label: 'Cancel',              shortcut: 'c',
          description: 'Keep editing the plan' },
      ],
      visibleRows: 4,
      footerHint: `↑↓/IJ select · ↵ confirm · jk scroll${editHint} · Esc`,
      onSubmit: v => resolve(v as PlanExitChoice),
      onCancel: () => resolve('cancel'),
    });

    const stack = LinearLayout.vertical(
      { view: this.preview },                // flex
      { view: this.choices, size: 7 },       // 4 rows + footer + padding
    );
    const frameTitle = `Review plan — ${title}`;
    this.root = new BoxView(
      stack,
      resolveWidgetChromeBoxViewOptions(
        undefined,
        resolveModalDialogChromeSpec(frameTitle, undefined, 'center'),
        frameTitle,
      ),
    );
  }

  draw(p: Printer): void { this.root.draw(p); }

  onEvent(ev: KeyEvent): EventResult {
    const n = (ev.name ?? '').toLowerCase();

    // Wave P3b · A6-1 — Ctrl-E external editor handoff. Suspend the
    // TUI, await the caller's editor flow, then refresh the preview
    // with the edited body. Guard against re-entry while an edit is
    // in flight (key repeat / IME quirks).
    if (ev.ctrl && (n === 'e' || n === 'ㄷ') && this.onRequestExternalEdit && !this.editInFlight) {
      this.editInFlight = true;
      const cb = this.onRequestExternalEdit;
      const onUpdated = this.onPlanBodyUpdated;
      const preview = this.preview;
      void (async () => {
        try {
          const next = await cb();
          if (next !== null && next !== undefined) {
            // Wave B — re-apply markdown rendering on Ctrl-E refresh
            // so the styling stays consistent with the initial draw.
            // The caller still receives the raw `next` body via
            // `onPlanBodyUpdated` for downstream handoff.
            preview.setText(renderPlanBodyMarkdown(next));
            onUpdated?.(next);
          }
        } catch {
          // Swallow — the editor handoff is best-effort. The plan body
          // remains as it was before the keypress.
        } finally {
          this.editInFlight = false;
        }
      })();
      return Consumed();
    }

    // Cancel family (escape / Ctrl-G / Ctrl-ㅎ for Korean IME)
    if (n === 'escape' || (ev.ctrl && (n === 'g' || n === 'ㅎ'))) {
      return this.choices.onEvent({ ...ev, name: 'escape' });
    }

    // Direct shortcut letters — SelectView also handles these but routing
    // here means we don't rely on the choice cursor state.
    if (!ev.ctrl && !ev.alt && (n === 'i' || n === 'n' || n === 'c')) {
      return this.choices.onEvent({ ...ev, name: n });
    }

    // 'return' → normalize to 'enter'
    if (n === 'return') {
      return this.choices.onEvent({ ...ev, name: 'enter' });
    }

    // Preview scroll keys routed to TextArea.
    if (n === 'j' || n === 'pagedown') return this.preview.onEvent(ev);
    if (n === 'k' || n === 'pageup')   return this.preview.onEvent(ev);

    // Selection navigation — translate h/l/left/right to up/down for
    // the vertical 3-choice list.
    if (n === 'h' || n === 'left')  return this.choices.onEvent({ ...ev, name: 'up' });
    if (n === 'l' || n === 'right') return this.choices.onEvent({ ...ev, name: 'down' });
    if (n === 'up' || n === 'down' || n === 'enter') {
      return this.choices.onEvent(ev);
    }

    return Ignored;
  }

  layout(size: Size): void { this.root.layout(size); }
  requiredSize(c: Size): Size { return this.root.requiredSize(c); }
  takeFocus(src?: FocusSource): boolean { return this.root.takeFocus(src); }
}
