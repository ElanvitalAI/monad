// IDX-F8b — modal popup pastel backdrop wiring.
//
// Verifies:
//   • resolveBackdropAnsi honours env kill-switch, explicit opt-out,
//     tier skip list, and missing theme
//   • mountViewAsModalSurface's paint() actually injects the backdrop
//     fill (space cells with the pastel bg ANSI) when a theme is
//     supplied via spec.theme or spec.shadow.theme
//
// The backdrop layer is cosmetic, so most tests look for the theme's
// backdrop SGR prefix in the output rather than pinning exact bytes.

import { describe, test, expect, afterEach } from 'bun:test';
import {
  mountViewAsModalSurface,
  resolveBackdropAnsi,
  BACKDROP_SKIP_TIERS,
  configureModalAdapterTheme,
  __resetModalAdapterThemeForTests,
} from '../src/ui/modal-adapter.js';
import { SelectView } from '../src/ui/widgets/select-view.js';
import { ELANOUS_PASTEL_DEFAULT } from '../src/themes/index.js';
import { ansiForPair, resolveWidgetTokens } from '../src/theme/tokens.js';

function makeView(): SelectView<string> {
  return new SelectView<string>({
    options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }],
    onSubmit: () => {},
  });
}

const PASTEL_BACKDROP_ANSI = ansiForPair(
  resolveWidgetTokens(ELANOUS_PASTEL_DEFAULT, 'modal').backdrop,
);

const originalEnv = process.env.ELANOUS_MODAL_BACKDROP;
afterEach(() => {
  if (originalEnv === undefined) delete process.env.ELANOUS_MODAL_BACKDROP;
  else process.env.ELANOUS_MODAL_BACKDROP = originalEnv;
  __resetModalAdapterThemeForTests();
});

describe('resolveBackdropAnsi', () => {
  test('returns "" when no theme is provided', () => {
    expect(resolveBackdropAnsi({})).toBe('');
  });

  test('returns ANSI when theme is provided + tier is not skipped', () => {
    const ansi = resolveBackdropAnsi({
      theme: ELANOUS_PASTEL_DEFAULT,
      tier: 'dialog',
    });
    expect(ansi).toBe(PASTEL_BACKDROP_ANSI);
    expect(ansi.length).toBeGreaterThan(0);
  });

  test('falls back to shadowTheme when theme is absent', () => {
    const ansi = resolveBackdropAnsi({
      shadowTheme: ELANOUS_PASTEL_DEFAULT,
      tier: 'dialog',
    });
    expect(ansi).toBe(PASTEL_BACKDROP_ANSI);
  });

  test('explicit spec.theme wins over shadowTheme', () => {
    // Same theme both places — we just verify the precedence path
    // doesn't drop the ANSI.
    const ansi = resolveBackdropAnsi({
      theme: ELANOUS_PASTEL_DEFAULT,
      shadowTheme: ELANOUS_PASTEL_DEFAULT,
      tier: 'dialog',
    });
    expect(ansi).toBe(PASTEL_BACKDROP_ANSI);
  });

  test('backdrop=false overrides theme+tier', () => {
    const ansi = resolveBackdropAnsi({
      theme: ELANOUS_PASTEL_DEFAULT,
      tier: 'dialog',
      backdrop: false,
    });
    expect(ansi).toBe('');
  });

  test('backdrop=true bypasses the tier skip list', () => {
    // vw is normally skipped, but an explicit backdrop:true wins.
    const ansi = resolveBackdropAnsi({
      theme: ELANOUS_PASTEL_DEFAULT,
      tier: 'vw',
      backdrop: true,
    });
    expect(ansi).toBe(PASTEL_BACKDROP_ANSI);
  });

  test('skip-list tiers omit backdrop by default', () => {
    for (const t of BACKDROP_SKIP_TIERS) {
      expect(resolveBackdropAnsi({
        theme: ELANOUS_PASTEL_DEFAULT,
        tier: t,
      })).toBe('');
    }
  });

  test('dialog and terminal keep backdrop by default', () => {
    const tiers = ['dialog', 'terminal'] as const;
    for (const t of tiers) {
      expect(resolveBackdropAnsi({
        theme: ELANOUS_PASTEL_DEFAULT,
        tier: t,
      })).toBe(PASTEL_BACKDROP_ANSI);
    }
  });

  test('ELANOUS_MODAL_BACKDROP=off disables backdrop globally', () => {
    process.env.ELANOUS_MODAL_BACKDROP = 'off';
    expect(resolveBackdropAnsi({
      theme: ELANOUS_PASTEL_DEFAULT,
      tier: 'dialog',
    })).toBe('');
  });

  test('env kill-switch wins even with backdrop=true', () => {
    process.env.ELANOUS_MODAL_BACKDROP = 'off';
    expect(resolveBackdropAnsi({
      theme: ELANOUS_PASTEL_DEFAULT,
      tier: 'dialog',
      backdrop: true,
    })).toBe('');
  });
});

describe('mountViewAsModalSurface — backdrop paint integration', () => {
  test('paint output contains backdrop ANSI when theme+dialog tier supplied', () => {
    const h = mountViewAsModalSurface({
      id: 'bd-dialog',
      bounds: { row: 1, col: 1, width: 20, height: 5 },
      view: makeView(),
      tier: 'dialog',
      theme: ELANOUS_PASTEL_DEFAULT,
    });
    const out = h.surface.paint();
    expect(out).toContain(PASTEL_BACKDROP_ANSI);
  });

  test('paint output omits backdrop ANSI when no theme supplied', () => {
    const h = mountViewAsModalSurface({
      id: 'bd-notheme',
      bounds: { row: 1, col: 1, width: 20, height: 5 },
      view: makeView(),
      tier: 'dialog',
    });
    const out = h.surface.paint();
    expect(out).not.toContain(PASTEL_BACKDROP_ANSI);
  });

  test('paint output omits backdrop for vw tier even with theme', () => {
    const h = mountViewAsModalSurface({
      id: 'bd-vw',
      bounds: { row: 1, col: 1, width: 20, height: 5 },
      view: makeView(),
      tier: 'vw',
      theme: ELANOUS_PASTEL_DEFAULT,
    });
    const out = h.surface.paint();
    expect(out).not.toContain(PASTEL_BACKDROP_ANSI);
  });

  test('backdrop=false overrides theme+tier even for dialog', () => {
    const h = mountViewAsModalSurface({
      id: 'bd-optout',
      bounds: { row: 1, col: 1, width: 20, height: 5 },
      view: makeView(),
      tier: 'dialog',
      theme: ELANOUS_PASTEL_DEFAULT,
      backdrop: false,
    });
    const out = h.surface.paint();
    expect(out).not.toContain(PASTEL_BACKDROP_ANSI);
  });

  test('popup tier omits backdrop by default even when theme is available', () => {
    const h = mountViewAsModalSurface({
      id: 'bd-popup-default-off',
      bounds: { row: 1, col: 1, width: 20, height: 5 },
      view: makeView(),
      tier: 'popup',
      theme: ELANOUS_PASTEL_DEFAULT,
    });
    const out = h.surface.paint();
    expect(out).not.toContain(PASTEL_BACKDROP_ANSI);
  });

  test('shadow.theme alone no longer forces popup backdrop by default', () => {
    const h = mountViewAsModalSurface({
      id: 'bd-shadowtheme',
      bounds: { row: 1, col: 1, width: 20, height: 5 },
      view: makeView(),
      tier: 'popup',
      shadow: { theme: ELANOUS_PASTEL_DEFAULT },
    });
    const out = h.surface.paint();
    expect(out).not.toContain(PASTEL_BACKDROP_ANSI);
  });

  test('backdrop=true opt-in still enables popup backdrop', () => {
    const h = mountViewAsModalSurface({
      id: 'bd-popup-opt-in',
      bounds: { row: 1, col: 1, width: 20, height: 5 },
      view: makeView(),
      tier: 'popup',
      theme: ELANOUS_PASTEL_DEFAULT,
      backdrop: true,
    });
    const out = h.surface.paint();
    expect(out).toContain(PASTEL_BACKDROP_ANSI);
  });
});

describe('configureModalAdapterTheme — ambient fallback', () => {
  test('ambient getter seeds backdrop when spec omits theme + shadow', () => {
    configureModalAdapterTheme(() => ELANOUS_PASTEL_DEFAULT);
    const h = mountViewAsModalSurface({
      id: 'bd-ambient',
      bounds: { row: 1, col: 1, width: 20, height: 5 },
      view: makeView(),
      tier: 'dialog',
    });
    expect(h.surface.paint()).toContain(PASTEL_BACKDROP_ANSI);
  });

  test('explicit spec.theme wins over ambient', () => {
    // Register ambient as undefined; verify spec.theme still works
    configureModalAdapterTheme(() => undefined);
    const h = mountViewAsModalSurface({
      id: 'bd-explicit',
      bounds: { row: 1, col: 1, width: 20, height: 5 },
      view: makeView(),
      tier: 'dialog',
      theme: ELANOUS_PASTEL_DEFAULT,
    });
    expect(h.surface.paint()).toContain(PASTEL_BACKDROP_ANSI);
  });

  test('ambient getter that throws is tolerated (returns "" silently)', () => {
    configureModalAdapterTheme(() => { throw new Error('boom'); });
    const ansi = resolveBackdropAnsi({ tier: 'dialog' });
    expect(ansi).toBe('');
  });

  test('reset clears the ambient getter', () => {
    configureModalAdapterTheme(() => ELANOUS_PASTEL_DEFAULT);
    __resetModalAdapterThemeForTests();
    expect(resolveBackdropAnsi({ tier: 'dialog' })).toBe('');
  });
});

// Phase D-3 cleanup (2026-04-21) — these tests used to verify the
// Option D post-frame backfill pass. After D-3 the backfill is gone;
// the same visual guarantee is now produced by `mergeStyle` inside
// `Printer.placeText` (see printer-cell-model.ts). The asserted
// behaviour — fg-only overlays preserve the backdrop bg continuously
// — is unchanged, so the tests stay valuable as integration pins.
describe('Backdrop auto-preservation via mergeStyle (formerly Option D)', () => {
  test('label/option rows carry backdrop ANSI continuously (no gap)', () => {
    // SelectView writes options rows that include:
    //   - Empty-SGR spans (pointer + padding + label text in default theme)
    //   - Fg-only spans (description — if any)
    // After D-2 mergeStyle, every non-empty cell in those rows has
    // the backdrop bg preserved because placeText merges incoming
    // SGR onto the existing cell style (backdrop laid down by
    // p.fill). Output shows BG before the 'Beta' literal.
    const h = mountViewAsModalSurface({
      id: 'bd-merge-continuous',
      bounds: { row: 1, col: 1, width: 30, height: 5 },
      view: makeView(),
      tier: 'dialog',
      theme: ELANOUS_PASTEL_DEFAULT,
    });
    const out = h.surface.paint();
    const bdIdx = out.indexOf(PASTEL_BACKDROP_ANSI);
    const betaIdx = out.indexOf('Beta');
    expect(bdIdx).toBeGreaterThanOrEqual(0);
    expect(betaIdx).toBeGreaterThanOrEqual(0);
    expect(bdIdx).toBeLessThan(betaIdx);
  });

  test('backdrop opt-out yields no backdrop anywhere', () => {
    // When backdrop=false, p.fill is skipped so cells start empty;
    // merge has nothing to preserve. Output carries no backdrop ANSI.
    const h = mountViewAsModalSurface({
      id: 'bd-merge-off',
      bounds: { row: 1, col: 1, width: 30, height: 5 },
      view: makeView(),
      tier: 'dialog',
      theme: ELANOUS_PASTEL_DEFAULT,
      backdrop: false,
    });
    const out = h.surface.paint();
    expect(out).not.toContain(PASTEL_BACKDROP_ANSI);
  });

  test('view’s explicit fg-only styles (description / muted spans) survive the merge', () => {
    // A view that emits a fg-only SGR must keep its fg in the final
    // output — merge overlays fg on top of the backdrop's bg rather
    // than clobbering. Proxy: SelectView with descriptions; the
    // description colour SGR appears alongside the backdrop ANSI.
    const viewWithDesc = (() => {
      const SelectViewCtor = makeView().constructor as new (cfg: unknown) => ReturnType<typeof makeView>;
      return new SelectViewCtor({
        options: [
          { value: 'a', label: 'Alpha', description: 'first option' },
          { value: 'b', label: 'Beta',  description: 'second option' },
        ],
        onSubmit: () => {},
      });
    })();
    const h = mountViewAsModalSurface({
      id: 'bd-merge-fg-preserved',
      bounds: { row: 1, col: 1, width: 40, height: 5 },
      view: viewWithDesc,
      tier: 'dialog',
      theme: ELANOUS_PASTEL_DEFAULT,
    });
    const out = h.surface.paint();
    expect(out).toContain(PASTEL_BACKDROP_ANSI);
    expect(out).toContain('first option');
    // Any 38;2 (truecolor fg) SGR — descriptions paint via paintPair
    // which emits 38;2;r;g;b. A truecolor FG sequence proves the
    // fg-only styles are not clobbered by merge.
    expect(out).toMatch(/\x1b\[38;2;\d+;\d+;\d+/);
  });
});
