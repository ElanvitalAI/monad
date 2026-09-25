// ── F6 LLM control · GetHoverTooltip + registration closure tests ──
//
// ROADMAP-ui-core-separation §4 Phase S1 sub-PR D.
// PLAN-ui-core-separation-next-arc.md §2 Sub-PR S1.D checkpoint.

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  buildGetHoverTooltipTool,
  dispatchGetHoverTooltip,
  getHoverTooltipRuntime,
  registerDisplayControlRuntimes,
  __resetDisplayControlRuntimesForTest,
} from '../../src/tool-runtime/display-control-runtimes.js';
import {
  getToolRuntime,
  listToolRuntimes,
  _resetToolRuntimeRegistryForTest,
} from '../../src/tool-runtime/registry.js';

function listIds(): string[] {
  return listToolRuntimes().map((rt) => rt.id);
}
import type { HitTarget } from '../../src/display/types.js';

const CTX = { surface: 'skill' as const };

beforeEach(() => {
  _resetToolRuntimeRegistryForTest();
  __resetDisplayControlRuntimesForTest();
});

describe('F6 · GetHoverTooltip tool', () => {
  test('returns the tooltip from the resolver for a known target', () => {
    const resolver = (t: HitTarget): string | null =>
      t.kind === 'pill' && t.name === 'model' ? 'switch model' : null;
    const out = dispatchGetHoverTooltip(
      { target: { kind: 'pill', name: 'model' } as HitTarget },
      { tooltipResolver: resolver },
    );
    expect(out.ok).toBe(true);
    expect(out.tooltip).toBe('switch model');
    expect(out.target).toEqual({ kind: 'pill', name: 'model' });
  });

  test('returns tooltip:null for an unknown target (not an error)', () => {
    const resolver = (): string | null => null;
    const out = dispatchGetHoverTooltip(
      { target: { kind: 'status-bar' } as HitTarget },
      { tooltipResolver: resolver },
    );
    expect(out.ok).toBe(true);
    expect(out.tooltip).toBeNull();
  });

  test('rejects malformed target', () => {
    const out = dispatchGetHoverTooltip(
      { target: 'pill' },
      { tooltipResolver: () => 'never' },
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('target required');
  });

  test('rejects target without kind', () => {
    const out = dispatchGetHoverTooltip(
      { target: { name: 'model' } },
      { tooltipResolver: () => 'never' },
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('target.kind required');
  });

  test('rejects when resolver missing', () => {
    const out = dispatchGetHoverTooltip(
      { target: { kind: 'pill', name: 'model' } as HitTarget },
      {},
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('tooltipResolver unavailable');
  });

  test('captures resolver throws as ok:false reason', () => {
    const resolver = (): string | null => {
      throw new Error('boom');
    };
    const out = dispatchGetHoverTooltip(
      { target: { kind: 'pill', name: 'model' } as HitTarget },
      { tooltipResolver: resolver },
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('tooltipResolver threw: boom');
  });

  test('tool spec exposes target as required', () => {
    const spec = buildGetHoverTooltipTool();
    expect(spec.name).toBe('GetHoverTooltip');
    expect(spec.parameters.required).toEqual(['target']);
  });
});

describe('F6 · S1.D + closure registration', () => {
  test('hover runtime returns stable id', () => {
    expect(getHoverTooltipRuntime().id).toBe('display_get_hover_tooltip');
  });

  test('registerDisplayControlRuntimes registers all 7 F6 tools', () => {
    registerDisplayControlRuntimes({
      tooltipResolver: () => null,
    });
    const ids = listIds();
    expect(ids).toContain('display_move_surface');
    expect(ids).toContain('display_resize_surface');
    expect(ids).toContain('display_close_surface');
    expect(ids).toContain('display_dismiss_modal');
    expect(ids).toContain('display_send_mouse_event');
    expect(ids).toContain('display_open_context_menu');
    expect(ids).toContain('display_get_hover_tooltip');
  });

  test('register is idempotent — second call updates deps but does not double-register', async () => {
    let calls = 0;
    registerDisplayControlRuntimes({
      tooltipResolver: () => {
        calls += 1;
        return 'first';
      },
    });
    const idsAfterFirst = listIds().filter((id) => id.startsWith('display_'));
    // Re-register with a new resolver — the deps closure is captured
    // by reference so subsequent calls use the new resolver.
    registerDisplayControlRuntimes({
      tooltipResolver: () => {
        calls += 1;
        return 'second';
      },
    });
    const idsAfterSecond = listIds().filter((id) => id.startsWith('display_'));
    expect(idsAfterSecond).toEqual(idsAfterFirst);
    const rt = getToolRuntime('display_get_hover_tooltip');
    const out = JSON.parse(
      ((await rt!.run({ target: { kind: 'pill', name: 'model' } }, CTX)) as { output: string })
        .output,
    );
    expect(out.tooltip).toBe('second');
    expect(calls).toBe(1);
  });

  test('runtime end-to-end — registry → run → JSON output', async () => {
    registerDisplayControlRuntimes({
      tooltipResolver: (t) =>
        t.kind === 'pill' && t.name === 'mode' ? 'change mode' : null,
    });
    const rt = getToolRuntime('display_get_hover_tooltip');
    const result = await rt!.run({ target: { kind: 'pill', name: 'mode' } }, CTX);
    const parsed = JSON.parse((result as { output: string }).output);
    expect(parsed.ok).toBe(true);
    expect(parsed.tooltip).toBe('change mode');
  });
});
