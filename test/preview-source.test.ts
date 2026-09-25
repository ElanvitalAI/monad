// ── Preview source switcher tests (view-aware, Phase S4) ──
// The dashboard keeps a `previewSource` ('working' | 'obsidian' |
// 'skill' | 'smart') plus a `lastBrowserFocus` tracker. The
// effective browser used to drive the preview pane depends on the
// current view too — Obsidian is only meaningful in V2, Skill in V3.

import { describe, test, expect } from 'bun:test';
import type { PreviewSource, WorkingDirView } from '../src/workspace-types.js';
import {
  cyclePreviewSourceForView,
  formatPreviewSourceLabel,
  normalizePreviewSourceForView,
  resolveEffectivePreviewBrowser,
  resolvePreviewBindingMode,
  setPreviewBindingMode,
  setPreviewSourceForView,
  shouldAutoRefreshPreview,
  type PreviewLastFocus as LastFocus,
} from '../src/preview-pane/model.js';

describe('fixed sources respect view context', () => {
  test('working pins working in every view', () => {
    for (const v of [1, 2, 3, 4] as const) {
      for (const l of ['browser', 'obsidian', 'skill-file'] as const) {
        expect(resolveEffectivePreviewBrowser('working', v, l)).toBe('working');
      }
    }
  });

  test('obsidian is honored only in V2', () => {
    expect(resolveEffectivePreviewBrowser('obsidian', 2, 'browser')).toBe('obsidian');
    expect(resolveEffectivePreviewBrowser('obsidian', 1, 'obsidian')).toBe('working');
    expect(resolveEffectivePreviewBrowser('obsidian', 3, 'obsidian')).toBe('working');
    expect(resolveEffectivePreviewBrowser('obsidian', 4, 'obsidian')).toBe('working');
  });

  test('skill is honored only in V3', () => {
    expect(resolveEffectivePreviewBrowser('skill', 3, 'browser')).toBe('skill');
    expect(resolveEffectivePreviewBrowser('skill', 1, 'skill-file')).toBe('working');
    expect(resolveEffectivePreviewBrowser('skill', 2, 'skill-file')).toBe('working');
    expect(resolveEffectivePreviewBrowser('skill', 4, 'skill-file')).toBe('working');
  });
});

describe('smart mode', () => {
  test('V1 Normal always resolves to working', () => {
    for (const l of ['browser', 'obsidian', 'skill-file'] as const) {
      expect(resolveEffectivePreviewBrowser('smart', 1, l)).toBe('working');
    }
  });

  test('V2 Obsidian follows obsidian focus, else working', () => {
    expect(resolveEffectivePreviewBrowser('smart', 2, 'browser')).toBe('working');
    expect(resolveEffectivePreviewBrowser('smart', 2, 'obsidian')).toBe('obsidian');
    // skill-file isn't relevant in V2 — falls back to working
    expect(resolveEffectivePreviewBrowser('smart', 2, 'skill-file')).toBe('working');
  });

  test('V3 Skill follows skill-file focus, else working', () => {
    expect(resolveEffectivePreviewBrowser('smart', 3, 'skill-file')).toBe('skill');
    expect(resolveEffectivePreviewBrowser('smart', 3, 'browser')).toBe('working');
    // obsidian isn't relevant in V3 — falls back to working
    expect(resolveEffectivePreviewBrowser('smart', 3, 'obsidian')).toBe('working');
  });
});

describe('title label', () => {
  test('fixed modes render the raw tag', () => {
    expect(formatPreviewSourceLabel('working', 1, 'browser')).toBe('WD');
    expect(formatPreviewSourceLabel('obsidian', 2, 'obsidian')).toBe('OB');
    expect(formatPreviewSourceLabel('skill', 3, 'skill-file')).toBe('SK');
  });

  test('smart reveals the tracked browser via the effective source', () => {
    expect(formatPreviewSourceLabel('smart', 2, 'obsidian')).toBe('SMART→OB');
    expect(formatPreviewSourceLabel('smart', 3, 'skill-file')).toBe('SMART→SK');
    expect(formatPreviewSourceLabel('smart', 1, 'browser')).toBe('SMART→WD');
  });

  test('fixed source in wrong view label collapses to WD', () => {
    // previewSource=obsidian in V3 → effective=working → tag=WD
    expect(formatPreviewSourceLabel('obsidian', 3, 'browser')).toBe('WD');
    expect(formatPreviewSourceLabel('skill', 1, 'browser')).toBe('WD');
  });
});

describe('m-key cycle varies by view', () => {
  test('V2 cycles working → obsidian → smart', () => {
    let s: PreviewSource = 'working';
    s = cyclePreviewSourceForView(2, s); expect(s).toBe('obsidian');
    s = cyclePreviewSourceForView(2, s); expect(s).toBe('smart');
    s = cyclePreviewSourceForView(2, s); expect(s).toBe('working');
  });

  test('V3 cycles working → skill → smart', () => {
    let s: PreviewSource = 'working';
    s = cyclePreviewSourceForView(3, s); expect(s).toBe('skill');
    s = cyclePreviewSourceForView(3, s); expect(s).toBe('smart');
    s = cyclePreviewSourceForView(3, s); expect(s).toBe('working');
  });

  test('V1 collapses to working ↔ smart', () => {
    expect(cyclePreviewSourceForView(1, 'working')).toBe('smart');
    expect(cyclePreviewSourceForView(1, 'smart')).toBe('working');
  });
});

describe('view switch reset rule', () => {
  test('obsidian survives only through V2 switches', () => {
    expect(normalizePreviewSourceForView('obsidian', 2)).toBe('obsidian');
    expect(normalizePreviewSourceForView('obsidian', 3)).toBe('smart');
  });
  test('skill survives only through V3 switches', () => {
    expect(normalizePreviewSourceForView('skill', 3)).toBe('skill');
    expect(normalizePreviewSourceForView('skill', 1)).toBe('smart');
  });
  test('working + smart are always preserved', () => {
    for (const v of [1, 2, 3, 4] as const) {
      expect(normalizePreviewSourceForView('working', v)).toBe('working');
      expect(normalizePreviewSourceForView('smart', v)).toBe('smart');
    }
  });
});

describe('preview binding mode', () => {
  test('follow binding auto-refreshes and pinned binding blocks it', () => {
    const preview = {
      followCursor: true,
      pinned: false,
    };
    expect(resolvePreviewBindingMode(preview)).toBe('follow');
    expect(shouldAutoRefreshPreview(preview)).toBe(true);

    setPreviewBindingMode(preview, 'pinned');

    expect(resolvePreviewBindingMode(preview)).toBe('pinned');
    expect(shouldAutoRefreshPreview(preview)).toBe(false);
  });

  test('explicit source changes return preview to follow mode', () => {
    const preview = {
      sourceMode: 'working' as PreviewSource,
      followCursor: false,
      pinned: true,
    };

    const next = setPreviewSourceForView(preview, 'obsidian', 3);

    expect(next).toBe('smart');
    expect(preview.sourceMode).toBe('smart');
    expect(resolvePreviewBindingMode(preview)).toBe('follow');
  });
});
