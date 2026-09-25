import { describe, expect, test } from 'bun:test';
import { createLayout, openModal } from '../src/layout/host.js';
import { routeLayoutModalKey } from '../src/layout/modal-router.js';
import { WidgetHost } from '../src/widgets/host.js';
import type { WidgetDef } from '../src/widgets/types.js';

function hostWith(def: WidgetDef): WidgetHost {
  const host = new WidgetHost({ log: () => {}, requestRender: () => {} });
  host.register(def);
  return host;
}

const baseWidget: WidgetDef<{ hits: number }> = {
  type: 'modal-test',
  description: 'test',
  initialState: () => ({ hits: 0 }),
  render: () => [],
  onKey: (ev, state) => {
    if (ev.name === 'j') {
      state.hits += 1;
      return { type: 'refresh' };
    }
    if (ev.name === 'enter') return { type: 'submit', text: 'picked' };
    if (ev.name === 'q') return { type: 'deactivate' };
    return { type: 'none' };
  },
};

describe('routeLayoutModalKey', () => {
  test('passthrough when no modal is open', () => {
    const host = hostWith(baseWidget);
    const layout = createLayout([{ cells: [{ widgetInstanceId: null }] }]);

    expect(routeLayoutModalKey(layout, host, { name: 'j' })).toEqual({ type: 'passthrough' });
  });

  test('escape closes the top modal and disposes its widget', () => {
    const host = hostWith(baseWidget);
    const inst = host.spawn({ type: 'modal-test' });
    const layout = openModal(createLayout([{ cells: [{ widgetInstanceId: null }] }]), {
      id: 'm1',
      widgetInstanceId: inst.id,
      position: 'center',
    });

    const routed = routeLayoutModalKey(layout, host, { name: 'escape' });

    expect(routed).toMatchObject({ type: 'closed', modalId: 'm1', widgetId: inst.id, reason: 'escape' });
    expect(routed.type === 'closed' ? routed.layout.modals : []).toHaveLength(0);
    expect(host.get(inst.id)).toBeNull();
  });

  test('routes keys to the modal widget and keeps underlying layout', () => {
    const host = hostWith(baseWidget);
    const inst = host.spawn({ type: 'modal-test' });
    const layout = openModal(createLayout([{ cells: [{ widgetInstanceId: null }] }]), {
      id: 'm1',
      widgetInstanceId: inst.id,
      position: 'center',
    });

    const routed = routeLayoutModalKey(layout, host, { name: 'j' });

    expect(routed).toMatchObject({ type: 'handled', action: { type: 'refresh' } });
    expect((host.get(inst.id)!.state as any).hits).toBe(1);
    expect(routed.type === 'handled' ? routed.layout : null).toBe(layout);
  });

  test('submit action is handled by the modal before dashboard panes', () => {
    const host = hostWith(baseWidget);
    const inst = host.spawn({ type: 'modal-test' });
    const layout = openModal(createLayout([{ cells: [{ widgetInstanceId: null }] }]), {
      id: 'm1',
      widgetInstanceId: inst.id,
      position: 'center',
    });

    expect(routeLayoutModalKey(layout, host, { name: 'enter' }))
      .toMatchObject({ type: 'handled', action: { type: 'submit', text: 'picked' } });
  });

  test('deactivate action closes only the modal, not the whole plugin', () => {
    const host = hostWith(baseWidget);
    const inst = host.spawn({ type: 'modal-test' });
    const layout = openModal(createLayout([{ cells: [{ widgetInstanceId: null }] }]), {
      id: 'm1',
      widgetInstanceId: inst.id,
      position: 'center',
    });

    const routed = routeLayoutModalKey(layout, host, { name: 'q' });

    expect(routed).toMatchObject({ type: 'closed', reason: 'deactivate' });
    expect(routed.type === 'closed' ? routed.layout.modals : []).toHaveLength(0);
  });

  test('missing modal widget self-heals by closing the modal', () => {
    const host = hostWith(baseWidget);
    const layout = openModal(createLayout([{ cells: [{ widgetInstanceId: null }] }]), {
      id: 'm1',
      widgetInstanceId: 'missing',
      position: 'center',
    });

    const routed = routeLayoutModalKey(layout, host, { name: 'j' });

    expect(routed).toMatchObject({ type: 'closed', reason: 'missing-widget' });
    expect(routed.type === 'closed' ? routed.layout.modals : []).toHaveLength(0);
  });
});
