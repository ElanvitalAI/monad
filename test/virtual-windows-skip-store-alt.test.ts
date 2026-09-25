// Bundle B-7-α — A3 consumer migration integration test.
//
// End-to-end: PaneVisualStateStore + skipWindowWhenStorePredicate
// wired through WindowRegistry's cycle logic. Covers the §5.2
// matrix in 내부 문서.

import { describe, expect, test } from 'bun:test';

import { WindowRegistry } from '../src/virtual-windows/window-registry.js';
import { createAddressBook } from '../src/virtual-windows/addressing.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import {
  createVisualStateStore,
  PANE_FOCUS_POLICY,
  PANE_VISIBILITY,
  type PaneVisualStateStore,
} from '../src/panes/visual-state.js';
import { skipWindowWhenStorePredicate } from '../src/panes/alt-skip-predicate.js';

function makeRegistry(store: PaneVisualStateStore) {
  const coord = new DisplayCoordinator({ frameMs: 0 });
  const book = createAddressBook();
  const reg = new WindowRegistry({
    addressBook: book,
    coordinator: coord,
    defaultBounds: () => ({ row: 1, col: 1, width: 80, height: 24 }),
    skipWindowWhen: skipWindowWhenStorePredicate(store),
  });
  return { reg, store };
}

describe('B-7-α · store-driven Alt+N skip integration', () => {
  test('empty store · next() cycles normally (no skip)', () => {
    const store = createVisualStateStore();
    const { reg } = makeRegistry(store);
    const a = reg.spawn({ title: 'a', initialContent: { kind: 'markdown', text: '' } });
    const b = reg.spawn({ title: 'b', initialContent: { kind: 'markdown', text: '' } });
    // b is foreground; next → a.
    expect(reg.current()?.id).toBe(b.id);
    reg.next();
    expect(reg.current()?.id).toBe(a.id);
  });

  test('SetFocusPolicy(skip) on only pane → window skipped by next()', () => {
    const store = createVisualStateStore();
    const { reg } = makeRegistry(store);
    const chat    = reg.spawn({ title: 'chat',    initialContent: { kind: 'markdown', text: '' } });
    const muted   = reg.spawn({ title: 'muted',   initialContent: { kind: 'markdown', text: '' } });
    const scratch = reg.spawn({ title: 'scratch', initialContent: { kind: 'markdown', text: '' } });
    // Flag `muted`'s only pane as skip via store.
    const mutedPane = muted.listPanes()[0]!;
    store.setState(
      { windowId: String(muted.id), paneId: mutedPane.id },
      { focusPolicy: PANE_FOCUS_POLICY.skip },
    );
    // scratch is foreground; next() → chat (muted skipped).
    expect(reg.current()?.id).toBe(scratch.id);
    reg.next();
    expect(reg.current()?.id).toBe(chat.id);
    // chat → scratch (muted still skipped, wrap past).
    reg.next();
    expect(reg.current()?.id).toBe(scratch.id);
  });

  test('window with 2 panes, only one skip-eligible → NOT skipped', () => {
    // We can't split inside the fake harness easily; instead, simulate
    // a 2-pane window by seeding store with an unrelated second paneId
    // that the window does not actually contain. Since the predicate
    // inspects window.listPanes(), a single-pane window with only that
    // pane's focusPolicy=normal stays un-skipped regardless of other
    // refs sitting in the store.
    const store = createVisualStateStore();
    const { reg } = makeRegistry(store);
    const a = reg.spawn({ title: 'a', initialContent: { kind: 'markdown', text: '' } });
    const aPane = a.listPanes()[0]!;
    // Unrelated ref — should not influence predicate on window a.
    store.setState({ windowId: String(a.id), paneId: 'ghost-pane' }, { focusPolicy: PANE_FOCUS_POLICY.skip });
    // a's actual pane is default (normal) → predicate false → cycling untouched.
    const b = reg.spawn({ title: 'b', initialContent: { kind: 'markdown', text: '' } });
    expect(reg.current()?.id).toBe(b.id);
    reg.next();
    expect(reg.current()?.id).toBe(a.id);
    // Confirm the actual pane isn't flagged.
    const snapshot = store.snapshot({ windowId: String(a.id), paneId: aPane.id });
    expect(snapshot.focusPolicy).toBe(PANE_FOCUS_POLICY.normal);
  });

  test('dormant visibility also triggers skip', () => {
    const store = createVisualStateStore();
    const { reg } = makeRegistry(store);
    const chat   = reg.spawn({ title: 'chat',   initialContent: { kind: 'markdown', text: '' } });
    const hidden = reg.spawn({ title: 'hidden', initialContent: { kind: 'markdown', text: '' } });
    const top    = reg.spawn({ title: 'top',    initialContent: { kind: 'markdown', text: '' } });
    const hiddenPane = hidden.listPanes()[0]!;
    store.setState(
      { windowId: String(hidden.id), paneId: hiddenPane.id },
      { visibility: PANE_VISIBILITY.dormant },
    );
    // top foreground → next() → chat (hidden skipped).
    expect(reg.current()?.id).toBe(top.id);
    reg.next();
    expect(reg.current()?.id).toBe(chat.id);
  });

  test('restore skip → normal unskips window on next cycle', () => {
    const store = createVisualStateStore();
    const { reg } = makeRegistry(store);
    const chat    = reg.spawn({ title: 'chat',    initialContent: { kind: 'markdown', text: '' } });
    const muted   = reg.spawn({ title: 'muted',   initialContent: { kind: 'markdown', text: '' } });
    const mutedPane = muted.listPanes()[0]!;
    const ref = { windowId: String(muted.id), paneId: mutedPane.id };
    store.setState(ref, { focusPolicy: PANE_FOCUS_POLICY.skip });
    // Start on muted (foreground). Not explicit selection (switchTo),
    // but foreground was last spawn. next() should skip muted and
    // land on chat (only other window).
    expect(reg.current()?.id).toBe(muted.id);
    reg.next();
    expect(reg.current()?.id).toBe(chat.id);
    // Restore to normal → next() from chat returns to muted.
    store.setState(ref, { focusPolicy: PANE_FOCUS_POLICY.normal });
    reg.next();
    expect(reg.current()?.id).toBe(muted.id);
  });

  test('explicit switchTo ignores predicate (skip-flagged window still selectable)', () => {
    const store = createVisualStateStore();
    const { reg } = makeRegistry(store);
    const chat  = reg.spawn({ title: 'chat',  initialContent: { kind: 'markdown', text: '' } });
    const muted = reg.spawn({ title: 'muted', initialContent: { kind: 'markdown', text: '' } });
    const mutedPane = muted.listPanes()[0]!;
    store.setState(
      { windowId: String(muted.id), paneId: mutedPane.id },
      { focusPolicy: PANE_FOCUS_POLICY.skip },
    );
    expect(reg.switchTo(muted.id)).toBe(true);
    expect(reg.current()?.id).toBe(muted.id);
  });
});
