import { describe, expect, test } from 'bun:test';
import {
  compactLevelForViewport,
  isCloseablePane,
  leadColumnVisibleForLevel,
  nextVisiblePaneFocus,
  repairFocusForVisiblePanes,
  visiblePanesForView,
} from '../src/views/pane-policy.js';

describe('view pane policy', () => {
  test('classifies viewport compact levels', () => {
    expect(compactLevelForViewport({ cols: 140, rows: 36 })).toBe('wide');
    expect(compactLevelForViewport({ cols: 110, rows: 36 })).toBe('medium');
    expect(compactLevelForViewport({ cols: 90, rows: 36 })).toBe('small');
    // Tablet tiers now preempt tiny / small — any cramped viewport
    // below the tablet thresholds falls into tabletTwo or tabletMini
    // regardless of whether cols OR rows is the tight axis.
    expect(compactLevelForViewport({ cols: 78, rows: 36 })).toBe('tabletTwo');
    expect(compactLevelForViewport({ cols: 52, rows: 36 })).toBe('tabletMini');
    expect(compactLevelForViewport({ cols: 90, rows: 19 })).toBe('tabletMini');
    expect(compactLevelForViewport({ cols: 90, rows: 25 })).toBe('tabletTwo');
  });

  test('tabletMini keeps only the primary pane + defers rest for modal', () => {
    const v = visiblePanesForView(1, { cols: 50, rows: 30 });
    expect(v.compactLevel).toBe('tabletMini');
    expect(v.visible).toEqual(['browser']);
    expect(v.modalDeferred.sort()).toEqual(['log', 'preview', 'sessions-sidebar']);
  });

  test('tabletTwo keeps primary + secondary + defers rest', () => {
    const v = visiblePanesForView(
      1, { cols: 78, rows: 30 },
      { secondary: 'preview' },
    );
    expect(v.compactLevel).toBe('tabletTwo');
    expect(v.visible.sort()).toEqual(['browser', 'preview']);
    expect(v.secondary).toBe('preview');
    expect(v.modalDeferred.sort()).toEqual(['log', 'sessions-sidebar']);
  });

  test('keepFocus overrides modal-deferred on tablet levels', () => {
    const v = visiblePanesForView(
      1, { cols: 50, rows: 30 },
      { keepFocus: 'preview', secondary: 'preview' },
    );
    expect(v.visible).toContain('preview');
    expect(v.modalDeferred).not.toContain('preview');
  });

  test('keeps the full view on wide terminals', () => {
    expect(visiblePanesForView(1, { cols: 140, rows: 36 }).visible).toEqual([
      'browser', 'preview', 'sessions-sidebar', 'log',
    ]);
  });

  test('medium terminals still keep the full V1 set', () => {
    const visibility = visiblePanesForView(1, { cols: 110, rows: 36 });
    expect(visibility.visible).toEqual(['browser', 'preview', 'sessions-sidebar', 'log']);
    expect(visibility.omitted).toEqual([]);
  });

  test('applies user closed panes before responsive omissions', () => {
    const closed = new Set(['preview'] as const);
    const visibility = visiblePanesForView(1, { cols: 140, rows: 36 }, { closed });
    expect(visibility.visible).toEqual(['browser', 'sessions-sidebar', 'log']);
    expect(visibility.omitted).toContainEqual({ pane: 'preview', reason: 'user-closed' });
  });

  test('does not allow primary pane close in a view', () => {
    expect(isCloseablePane(1, 'browser')).toBe(false);
    expect(isCloseablePane(1, 'preview')).toBe(true);
    // V4 (scheduler) was retired 2026-05-11 (Surface-unification v2.2
    // V2.2-5 Part 2) and now falls back to the V1 pane set
    // [browser, preview, sessions-sidebar, log] with `browser` as its
    // primary. The scheduler-* panes no longer belong to view 4.
    expect(isCloseablePane(4, 'browser')).toBe(false); // primary
    expect(isCloseablePane(4, 'preview')).toBe(true);
    // Retired scheduler panes are not part of view 4's pane set → not closeable.
    expect(isCloseablePane(4, 'scheduler-inspector')).toBe(false);
  });

  test('repairs focus to a visible pane when current pane is closed', () => {
    const closed = new Set(['scratch'] as const);
    expect(repairFocusForVisiblePanes('scratch', 1, { cols: 140, rows: 36 }, { closed })).toBe('browser');
  });

  test('cycles only through visible panes', () => {
    const closed = new Set(['preview'] as const);
    expect(nextVisiblePaneFocus('browser', 1, 1, { cols: 110, rows: 36 }, { closed })).toBe('sessions-sidebar');
    expect(nextVisiblePaneFocus('sessions-sidebar', 1, 1, { cols: 110, rows: 36 }, { closed })).toBe('log');
  });

  test('tablet view 4 keeps primary + focused detail when possible', () => {
    // V4 (scheduler) retired 2026-05-11 (Surface-unification v2.2 V2.2-5
    // Part 2) → falls back to the V1 pane set
    // [browser, preview, sessions-sidebar, log] with `browser` primary.
    // 64x16 → tabletMini; keepFocus overrides modal-deferred.
    const visibility = visiblePanesForView(4, { cols: 64, rows: 16 }, { keepFocus: 'preview' });
    expect(visibility.visible).toContain('browser');   // primary survives
    expect(visibility.visible).toContain('preview');   // keepFocus survives modal-defer
    // The rest is deferred to the Ctrl+M modal, not dropped outright.
    expect(visibility.modalDeferred).toContain('log');
    expect(visibility.omitted.map(o => o.pane)).toContain('sessions-sidebar');
  });

  describe('ST4 — leadColumn CompactLevel gate', () => {
    test('leadColumnVisibleForLevel maps wide/medium → true, rest → false', () => {
      expect(leadColumnVisibleForLevel('wide')).toBe(true);
      expect(leadColumnVisibleForLevel('medium')).toBe(true);
      expect(leadColumnVisibleForLevel('small')).toBe(false);
      expect(leadColumnVisibleForLevel('tiny')).toBe(false);
      expect(leadColumnVisibleForLevel('tabletTwo')).toBe(false);
      expect(leadColumnVisibleForLevel('tabletMini')).toBe(false);
    });

    test('wide keeps sessions-sidebar visible when it is a leadColumn pane', () => {
      const v = visiblePanesForView(
        1, { cols: 140, rows: 36 },
        {
          panes: ['sessions-sidebar', 'browser', 'preview', 'scratch', 'log'],
          primary: 'browser',
          leadColumnPanes: ['sessions-sidebar'],
          omitOrder: ['scratch', 'preview', 'log', 'browser', 'sessions-sidebar'],
        },
      );
      expect(v.compactLevel).toBe('wide');
      expect(v.visible).toContain('sessions-sidebar');
      expect(v.omitted.map(o => o.pane)).not.toContain('sessions-sidebar');
    });

    test('medium keeps sessions-sidebar (only scratch is pruned)', () => {
      const v = visiblePanesForView(
        1, { cols: 110, rows: 36 },
        {
          panes: ['sessions-sidebar', 'browser', 'preview', 'scratch', 'log'],
          primary: 'browser',
          leadColumnPanes: ['sessions-sidebar'],
          omitOrder: ['scratch', 'preview', 'log', 'browser', 'sessions-sidebar'],
        },
      );
      expect(v.compactLevel).toBe('medium');
      expect(v.visible).toContain('sessions-sidebar');
      expect(v.visible).not.toContain('scratch');
    });

    test('small hides sessions-sidebar with too-narrow reason', () => {
      // 90×36 → small (cols ≥72 and <96 triggers small per
      // compactLevelForViewport).
      const v = visiblePanesForView(
        1, { cols: 90, rows: 36 },
        {
          panes: ['sessions-sidebar', 'browser', 'preview', 'scratch', 'log'],
          primary: 'browser',
          leadColumnPanes: ['sessions-sidebar'],
          omitOrder: ['scratch', 'preview', 'log', 'browser', 'sessions-sidebar'],
        },
      );
      expect(v.compactLevel).toBe('small');
      expect(v.visible).not.toContain('sessions-sidebar');
      expect(v.omitted).toContainEqual({ pane: 'sessions-sidebar', reason: 'too-narrow' });
    });

    test('tabletMini keeps sessions-sidebar in modal-deferred, not too-narrow', () => {
      // Tablet branch fires first (modal-deferred takes precedence over
      // the leadColumn gate); the leadColumn gate should be a no-op.
      const v = visiblePanesForView(
        1, { cols: 50, rows: 30 },
        {
          panes: ['sessions-sidebar', 'browser', 'preview', 'scratch', 'log'],
          primary: 'browser',
          leadColumnPanes: ['sessions-sidebar'],
          omitOrder: ['scratch', 'preview', 'log', 'browser', 'sessions-sidebar'],
        },
      );
      expect(v.compactLevel).toBe('tabletMini');
      expect(v.modalDeferred).toContain('sessions-sidebar');
      expect(v.omitted.find(o => o.pane === 'sessions-sidebar')?.reason).toBe('modal-deferred');
    });

    test('keepFocus on a leadColumn pane overrides the gate (user focused it)', () => {
      const v = visiblePanesForView(
        1, { cols: 90, rows: 36 },
        {
          panes: ['sessions-sidebar', 'browser', 'preview', 'scratch', 'log'],
          primary: 'browser',
          keepFocus: 'sessions-sidebar',
          leadColumnPanes: ['sessions-sidebar'],
          omitOrder: ['scratch', 'preview', 'log', 'browser', 'sessions-sidebar'],
        },
      );
      expect(v.compactLevel).toBe('small');
      expect(v.visible).toContain('sessions-sidebar');
    });
  });

  describe('T-1 — tablet mode manual override', () => {
    test('tabletMode on wide viewport collapses to log + modal-deferred rest', () => {
      // Wide terminal but tablet mode enabled → behave like tabletMini
      // with `log` as primary (regardless of view's default browser).
      const v = visiblePanesForView(
        1, { cols: 140, rows: 36 },
        { tabletMode: true },
      );
      expect(v.compactLevel).toBe('wide'); // raw viewport is reported
      expect(v.primary).toBe('log');
      expect(v.visible).toEqual(['log']);
      expect(v.modalDeferred.sort()).toEqual(['browser', 'preview', 'sessions-sidebar']);
    });

    test('tabletMode preserves keepFocus override', () => {
      const v = visiblePanesForView(
        1, { cols: 140, rows: 36 },
        { tabletMode: true, keepFocus: 'browser' },
      );
      expect(v.primary).toBe('log');
      expect(v.visible.sort()).toEqual(['browser', 'log']);
      expect(v.modalDeferred).not.toContain('browser');
    });

    test('tabletMode promotes log only if log is in the pane set', () => {
      // View without 'log' (hypothetical) — primary falls back to
      // the view default rather than failing.
      const v = visiblePanesForView(
        1, { cols: 140, rows: 36 },
        {
          panes: ['browser', 'preview'],
          primary: 'browser',
          tabletMode: true,
        },
      );
      expect(v.primary).toBe('browser');
      expect(v.visible).toEqual(['browser']);
      expect(v.modalDeferred).toEqual(['preview']);
    });

    test('tabletMode is orthogonal to viewport — already-tabletMini is fine', () => {
      // Auto tablet (small viewport) + manual tabletMode → same result
      // as just auto. No double-counting.
      const v = visiblePanesForView(
        1, { cols: 50, rows: 30 },
        { tabletMode: true },
      );
      expect(v.compactLevel).toBe('tabletMini');
      expect(v.primary).toBe('log');
      expect(v.visible).toEqual(['log']);
    });

    test('tabletMode with sessions-sidebar leadColumn — sidebar joins modal-deferred', () => {
      // ST3/ST4 interaction: leadColumn gate would prune at small+
      // but here tabletMode's broader prune takes precedence. sidebar
      // ends up in modal-deferred (reachable via Ctrl+M), not
      // too-narrow.
      const v = visiblePanesForView(
        1, { cols: 140, rows: 36 },
        {
          panes: ['sessions-sidebar', 'browser', 'preview', 'scratch', 'log'],
          primary: 'browser',
          leadColumnPanes: ['sessions-sidebar'],
          tabletMode: true,
          omitOrder: ['scratch', 'preview', 'log', 'browser', 'sessions-sidebar'],
        },
      );
      expect(v.primary).toBe('log');
      expect(v.visible).toEqual(['log']);
      expect(v.modalDeferred).toContain('sessions-sidebar');
      expect(v.omitted.find(o => o.pane === 'sessions-sidebar')?.reason).toBe('modal-deferred');
    });
  });
});
