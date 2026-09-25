import { describe, expect, test } from 'bun:test';
import { createWidgetView } from '../src/dashboard/widget-modal-popup.js';
import type { WidgetDef } from '../src/widgets/types.js';

interface State { rows: string[]; cursor: number }

const fakeWidgetDef: WidgetDef<State, Record<string, unknown>> = {
  type: 'fake',
  description: 'fake',
  initialState() { return { rows: ['a', 'b'], cursor: 0 }; },
  render(state, ctx) {
    const lines: string[] = [];
    for (let i = 0; i < state.rows.length; i++) {
      const cursor = i === state.cursor ? '> ' : '  ';
      lines.push(`${cursor}${state.rows[i]}`);
    }
    return lines.slice(0, ctx.height);
  },
  onKey(ev, state) {
    if (ev.name === 'j') {
      state.cursor = Math.min(state.cursor + 1, state.rows.length - 1);
      return { type: 'refresh' };
    }
    return { type: 'none' };
  },
};

function makeFakeHost(initialInst: { def: WidgetDef<unknown, unknown>; state: unknown; type: string; character?: string } | null) {
  return {
    get(_id: string) { return initialInst; },
  } as never;
}

describe('createWidgetView (Wave P4b-1)', () => {
  test('returns null when widget instance is missing', () => {
    const host = makeFakeHost(null);
    const v = createWidgetView(host, 'wd-missing');
    expect(v).toBeNull();
  });

  test('draw renders the widget def output line by line', () => {
    const inst = {
      def: fakeWidgetDef as unknown as WidgetDef<unknown, unknown>,
      state: { rows: ['x', 'y', 'z'], cursor: 1 },
      type: 'fake',
      character: 'Fake',
    };
    const host = makeFakeHost(inst);
    const view = createWidgetView(host, 'wd-fake');
    expect(view).not.toBeNull();
    const writes: { x: number; y: number; str: string }[] = [];
    const printer = {
      width: 80,
      height: 10,
      focused: true,
      text(x: number, y: number, str: string) {
        writes.push({ x, y, str });
        return printer;
      },
    } as unknown as Parameters<typeof view.draw>[0];
    view!.draw(printer);
    expect(writes.length).toBe(3);
    expect(writes[0]!.str).toContain('x');
    expect(writes[1]!.str).toContain('y');
    expect(writes[2]!.str).toContain('z');
  });

  test('onEvent forwards to widget def.onKey and maps refresh→Consumed', () => {
    const state = { rows: ['x', 'y'], cursor: 0 };
    const inst = {
      def: fakeWidgetDef as unknown as WidgetDef<unknown, unknown>,
      state,
      type: 'fake',
    };
    const host = makeFakeHost(inst);
    const view = createWidgetView(host, 'wd-fake')!;
    const r = view.onEvent({ name: 'j', sequence: 'j' } as never);
    expect(r.kind).toBe('consumed');
    expect((state as { cursor: number }).cursor).toBe(1);
  });

  test('onEvent returns Ignored for unhandled keys', () => {
    const inst = {
      def: fakeWidgetDef as unknown as WidgetDef<unknown, unknown>,
      state: { rows: ['x'], cursor: 0 },
      type: 'fake',
    };
    const host = makeFakeHost(inst);
    const view = createWidgetView(host, 'wd-fake')!;
    const r = view.onEvent({ name: 'x', sequence: 'x' } as never);
    expect(r.kind).toBe('ignored');
  });

  test('takeFocus accepts focus', () => {
    const inst = {
      def: fakeWidgetDef as unknown as WidgetDef<unknown, unknown>,
      state: { rows: [], cursor: 0 },
      type: 'fake',
    };
    const view = createWidgetView(makeFakeHost(inst), 'wd-fake')!;
    expect(view.takeFocus()).toBe(true);
  });

  test('draw caps lines at printer.height', () => {
    const inst = {
      def: fakeWidgetDef as unknown as WidgetDef<unknown, unknown>,
      state: { rows: ['1', '2', '3', '4', '5'], cursor: 0 },
      type: 'fake',
    };
    const view = createWidgetView(makeFakeHost(inst), 'wd-fake')!;
    const writes: { x: number; y: number; str: string }[] = [];
    const printer = {
      width: 80,
      height: 2,
      focused: true,
      text(x: number, y: number, str: string) { writes.push({ x, y, str }); return printer; },
    } as unknown as Parameters<typeof view.draw>[0];
    view.draw(printer);
    expect(writes.length).toBe(2);
  });

  test('widget context setState merges patch into instance state', () => {
    const inst = {
      def: {
        ...fakeWidgetDef,
        onKey(ev, _state, ctx) {
          if (ev.name === 'p') {
            (ctx as unknown as { setState: (p: Partial<State>) => void }).setState({ cursor: 99 });
            return { type: 'refresh' };
          }
          return { type: 'none' };
        },
      } as unknown as WidgetDef<unknown, unknown>,
      state: { rows: ['x'], cursor: 0 },
      type: 'fake',
    };
    const view = createWidgetView(makeFakeHost(inst), 'wd-fake')!;
    view.onEvent({ name: 'p', sequence: 'p' } as never);
    expect((inst.state as { cursor: number }).cursor).toBe(99);
  });
});
