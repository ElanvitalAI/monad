import { describe, expect, test } from 'bun:test';
import { createIulAssetView } from './asset-registry.js';
import playgroundWidget from '../playground/widget.js';
import { DEFAULT_THEME_TOKENS } from '../theme/tokens.js';
import type { WidgetContext } from '../widgets/types.js';
import type { PlaygroundWidgetState } from '../playground/widget.js';

function buildCtx() {
  return {
    catalogById: new Map(),
    resolveTheme: () => DEFAULT_THEME_TOKENS,
  };
}

describe('IUL yaml-editor WidgetContext size wiring', () => {
  test('omits width/height until layout, then injects the laid-out size', () => {
    const view = createIulAssetView('yaml-editor', buildCtx());
    const seen: WidgetContext<PlaygroundWidgetState>[] = [];
    const original = playgroundWidget.onKey;
    playgroundWidget.onKey = (ev, state, ctx) => {
      seen.push(ctx);
      return original?.(ev, state, ctx) ?? { type: 'none' };
    };
    try {
      view.onEvent?.({ name: 'down' } as never);
      expect(seen).toHaveLength(1);
      expect(Object.prototype.hasOwnProperty.call(seen[0], 'width')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(seen[0], 'height')).toBe(false);
      expect(seen[0]?.width).toBeUndefined();
      expect(seen[0]?.height).toBeUndefined();
      expect(seen[0]?.width ?? 8).toBe(8);

      view.layout?.({ width: 80, height: 24 });
      view.onEvent?.({ name: 'down' } as never);
      expect(seen).toHaveLength(2);
      expect(seen[1]?.width).toBe(80);
      expect(seen[1]?.height).toBe(24);
    } finally {
      playgroundWidget.onKey = original;
    }
  });
});
