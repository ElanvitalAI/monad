// AskUserQuestion TUI modal — Phase WF1 (LC12c refactor).
//
// External contract unchanged — `createAskUserQuestionModal(spec)`
// still returns `{ surface, promise, handleKey, dispose }`. Internals
// flipped onto LC6+ widgets:
//   - SelectView (one per question, rebuilt on advance)
//   - EditView    (for the "Other" free-form typing mode)
//   - BoxView + LinearLayout for framing
//
// The sequential walk (1–3 questions) + Other free-form + multi-
// select flow is preserved through a small AskQuestionWalk composite
// View that holds the per-question state and re-arms the SelectView
// on advance / cancel.

import type { ModalSurface, ModalBounds } from '../display/modal-stack.js';
import type { KeyEvent } from '../display/types.js';
import { BoxView, TextView, Consumed, Ignored, type EventResult, type FocusSource, type Size, type View } from '../ui/view.js';
import type { Printer } from '../ui/printer.js';
import { LinearLayout } from '../ui/layout/linear.js';
import { SelectView, type SelectOption } from '../ui/widgets/select-view.js';
import { EditView, createPromptEditView } from '../ui/widgets/edit-view.js';
import { mountViewAsModalSurface } from '../ui/modal-adapter.js';
import { resolveWidgetChromeBoxViewOptions } from '../ui/declarative/index.js';
import { resolveModalDialogChromeSpec } from '../ui/chrome/dialog-chrome.js';
import { C } from '../tui.js';
import type {
  AskUserQuestionRequest,
  AskUserQuestionResult,
  Question,
} from './types.js';

const OTHER_LABEL = 'Other';

export interface AskUserQuestionModalSpec {
  id: string;
  bounds: ModalBounds;
  request: AskUserQuestionRequest;
}

export interface AskUserQuestionModalHandle {
  surface: ModalSurface;
  promise: Promise<AskUserQuestionResult>;
  handleKey(ev: KeyEvent): 'consumed' | 'passthrough';
  dispose(cancelled?: boolean): void;
}

export function createAskUserQuestionModal(spec: AskUserQuestionModalSpec): AskUserQuestionModalHandle {
  const answers: Record<string, string | string[]> = {};
  const otherText: Record<string, string> = {};
  let resolver: ((r: AskUserQuestionResult) => void) | null = null;
  const promise = new Promise<AskUserQuestionResult>(r => { resolver = r; });
  let resolved = false;

  const resolve = (cancelled: boolean): void => {
    if (resolved) return;
    resolved = true;
    const res: AskUserQuestionResult = { answers };
    if (Object.keys(otherText).length > 0) res.otherText = otherText;
    if (cancelled) res.cancelled = true;
    resolver?.(res);
  };

  const view = new AskQuestionWalk(spec.request, answers, otherText, resolve);
  const mounted = mountViewAsModalSurface({
    id: spec.id,
    bounds: spec.bounds,
    view,
    priority: 250,
    tier: 'dialog',
  });

  const handleKey = (ev: KeyEvent): 'consumed' | 'passthrough' => {
    if (resolved) return 'passthrough';
    mounted.handleKey(ev);
    // Modal is exclusive while open — swallow every key.
    return 'consumed';
  };

  const dispose = (cancelled?: boolean): void => {
    resolve(cancelled !== false);
    mounted.dispose();
  };

  return { surface: mounted.surface, promise, handleKey, dispose };
}

// ── Composite View that walks through N questions ──────────────

class AskQuestionWalk implements View {
  private idx = 0;
  private mode: 'list' | 'other' = 'list';
  private select: SelectView<string>;
  private otherInput: EditView | null = null;
  private root: View;

  constructor(
    private request: AskUserQuestionRequest,
    private answers: Record<string, string | string[]>,
    private otherText: Record<string, string>,
    private done: (cancelled: boolean) => void,
  ) {
    this.select = this.buildSelect();
    this.root = this.buildFrame();
  }

  private currentQuestion(): Question { return this.request.questions[this.idx]!; }

  private buildSelect(): SelectView<string> {
    const q = this.currentQuestion();
    const options: SelectOption<string>[] = q.options.map(o => ({
      value: o.label,
      label: o.label,
      description: o.description,
    }));
    if (q.includeOther !== false) {
      options.push({
        value: OTHER_LABEL,
        label: OTHER_LABEL,
        description: 'Type your own response',
      });
    }
    const view = new SelectView<string>({
      options,
      multi: q.multiSelect,
      visibleRows: Math.min(options.length, 10),
      footerHint: q.multiSelect
        ? 'Space toggle · ↵ submit · Esc'
        : '1-9 / ↑↓ select · ↵ next · Esc',
      onSubmit: (picked, feedback) => this.handleSubmit(picked, feedback),
      onCancel: () => this.done(true),
    });
    view.takeFocus('front');
    return view;
  }

  private buildFrame(): View {
    const q = this.currentQuestion();
    const title = `[${q.header}]  Q ${this.idx + 1}/${this.request.questions.length}`;
    const children: { view: View; size?: number }[] = [
      { view: new TextView(C.bold(q.question)), size: 1 },
      { view: new TextView(''), size: 1 },
    ];
    if (this.mode === 'list') {
      children.push({ view: this.select });   // flex
    } else if (this.otherInput) {
      const listSize = Math.min(q.options.length + (q.includeOther !== false ? 1 : 0) + 1 /* footer */, 6);
      children.push({ view: this.select, size: listSize });
      children.push({ view: new TextView(''), size: 1 });
      children.push({ view: this.otherInput, size: 1 });
    }
    return new BoxView(
      LinearLayout.vertical(...children),
      resolveWidgetChromeBoxViewOptions(
        undefined,
        resolveModalDialogChromeSpec(title, undefined, 'center'),
        title,
      ),
    );
  }

  private handleSubmit(picked: string | string[], _feedback?: string): void {
    const q = this.currentQuestion();
    if (q.multiSelect) {
      const arr = picked as string[];
      if (arr.length === 0) return;             // Enter with none → no-op
      this.answers[q.id] = arr;
      this.advance();
      return;
    }
    const value = picked as string;
    if (value === OTHER_LABEL) {
      this.enterOtherMode();
      return;
    }
    this.answers[q.id] = value;
    this.advance();
  }

  private enterOtherMode(): void {
    this.mode = 'other';
    const q = this.currentQuestion();
    this.otherInput = createPromptEditView({
      placeholder: 'Other › ',
      submitMode: 'trimmed',
      emptySubmit: 'ignore',
      onSubmit: value => {
        this.answers[q.id] = OTHER_LABEL;
        this.otherText[q.id] = value;
        this.advance();
      },
      onCancel: () => this.exitOtherMode(),
    });
    this.otherInput.takeFocus();
    this.root = this.buildFrame();
  }

  private exitOtherMode(): void {
    this.mode = 'list';
    this.otherInput = null;
    this.select.takeFocus('front');
    this.root = this.buildFrame();
  }

  private advance(): void {
    if (this.idx + 1 < this.request.questions.length) {
      this.idx++;
      this.select = this.buildSelect();
      this.mode = 'list';
      this.otherInput = null;
      this.root = this.buildFrame();
    } else {
      this.done(false);
    }
  }

  draw(p: Printer): void { this.root.draw(p); }

  onEvent(ev: KeyEvent): EventResult {
    const name = (ev.name ?? '').toLowerCase();

    // Ctrl-G / Ctrl-ㅎ cancels everywhere.
    if (ev.ctrl && (name === 'g' || name === 'ㅎ')) {
      this.done(true);
      return Consumed();
    }

    // Normalize 'return' → 'enter' so downstream widgets see one name.
    const norm: KeyEvent = name === 'return' ? { ...ev, name: 'enter' } : ev;

    if (this.mode === 'other' && this.otherInput) {
      if (name === 'escape') {
        this.exitOtherMode();
        return Consumed();
      }
      return this.otherInput.onEvent(norm);
    }

    // Space on Other row in single-select → open Other typing mode.
    if (name === 'space' && !this.currentQuestion().multiSelect) {
      const snap = this.select._snapshot();
      const q = this.currentQuestion();
      const total = q.options.length + (q.includeOther !== false ? 1 : 0);
      if (q.includeOther !== false && snap.cursor === total - 1) {
        this.enterOtherMode();
        return Consumed();
      }
    }

    return this.select.onEvent(norm);
  }

  layout(s: Size): void { this.root.layout(s); }
  requiredSize(c: Size): Size { return this.root.requiredSize(c); }
  takeFocus(src?: FocusSource): boolean { return this.select.takeFocus(src); }
}
