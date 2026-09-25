// IDX-F5d — applyPaneIdToRefinement composition tests. Mirror of the
// existing applyModalIdToRefinement tests (test/hit-target.test.ts)
// but for the pane rail. Proves the helper is:
//   1. pure — same inputs → same shape
//   2. conservative — null refinement → no `hit` field
//   3. exhaustive — every WidgetHitDescriptor kind round-trips into
//      the composed HitTarget without loss

import { describe, expect, test } from 'bun:test';

import type { HitTarget, WidgetHitDescriptor } from '../src/display/types.js';
import { applyPaneIdToRefinement } from '../src/display/hit-target.js';

describe('applyPaneIdToRefinement', () => {
  test('null refinement → pane-body without `hit` field', () => {
    const t = applyPaneIdToRefinement('wd-browser', 'wd-browser', 5, 12, null);
    expect(t).toEqual({
      kind: 'pane-body',
      paneId: 'wd-browser',
      widgetInstanceId: 'wd-browser',
      bodyRow: 5,
      bodyCol: 12,
    });
    expect('hit' in t).toBe(false);
  });

  test('list-row refinement → pane-body with hit.itemIndex', () => {
    const refinement: WidgetHitDescriptor = { kind: 'list-row', itemIndex: 7 };
    const t = applyPaneIdToRefinement('wd-browser', 'wd-browser', 5, 12, refinement);
    expect(t.hit).toEqual({ kind: 'list-row', itemIndex: 7 });
    expect(t.paneId).toBe('wd-browser');
    expect(t.bodyRow).toBe(5);
  });

  test('table-cell refinement → pane-body with hit.row/col', () => {
    const refinement: WidgetHitDescriptor = { kind: 'table-cell', row: 3, col: 4 };
    const t = applyPaneIdToRefinement('wd-scheduler-board', 'wd-scheduler-board', 2, 30, refinement);
    expect(t.hit).toEqual({ kind: 'table-cell', row: 3, col: 4 });
  });

  test('text-char refinement → pane-body with hit.line/col', () => {
    const refinement: WidgetHitDescriptor = { kind: 'text-char', line: 10, col: 25 };
    const t = applyPaneIdToRefinement('wd-preview', 'wd-preview', 6, 25, refinement);
    expect(t.hit).toEqual({ kind: 'text-char', line: 10, col: 25 });
  });

  test('conversation-message refinement → pane-body with message metadata', () => {
    const refinement: WidgetHitDescriptor = {
      kind: 'conversation-message',
      sessionId: 'emb-1',
      messageId: 'channel:message',
      role: 'assistant',
      rangeStart: 3,
      rangeEnd: 6,
    };
    const t = applyPaneIdToRefinement('wd-conversation', 'wd-conversation', 6, 25, refinement);
    expect(t.hit).toEqual(refinement);
  });

  test('omits undefined optional fields so diag snapshots stay terse', () => {
    const t = applyPaneIdToRefinement('wd-browser', undefined, undefined, undefined, null);
    expect(t).toEqual({ kind: 'pane-body', paneId: 'wd-browser' });
    expect('widgetInstanceId' in t).toBe(false);
    expect('bodyRow' in t).toBe(false);
    expect('bodyCol' in t).toBe(false);
    expect('hit' in t).toBe(false);
  });

  test('same inputs return structurally-equal outputs (pure)', () => {
    const a = applyPaneIdToRefinement('p', 'w', 3, 3, { kind: 'list-row', itemIndex: 1 });
    const b = applyPaneIdToRefinement('p', 'w', 3, 3, { kind: 'list-row', itemIndex: 1 });
    expect(a).toEqual(b);
  });

  test('composed HitTarget narrows exhaustively on kind', () => {
    // Type-level check: the returned object must be the pane-body
    // variant of the HitTarget union. A narrow via `kind` should
    // expose paneId + optional hit.
    const t: HitTarget = applyPaneIdToRefinement('x', 'y', 0, 0, null);
    if (t.kind === 'pane-body') {
      // TS knows paneId is required · hit is optional
      expect(typeof t.paneId).toBe('string');
      expect(t.hit).toBeUndefined();
    } else {
      throw new Error('unreachable — applyPaneIdToRefinement should always return pane-body');
    }
  });
});
