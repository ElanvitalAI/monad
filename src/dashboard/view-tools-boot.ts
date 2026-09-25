import type {
  DashboardViewInfo,
  DashboardWidgetInvokeOps,
} from '../skills/tools/dashboard-view.js';

export interface DashboardViewToolsBootDeps {
  initDashboardViewTools: (
    viewOps: {
      list: () => DashboardViewInfo[];
      switchTo: (needle: string) => string | null;
    },
    widgetOps: DashboardWidgetInvokeOps,
  ) => void;
  listViews: () => DashboardViewInfo[];
  switchViewByNeedle: (needle: string) => string | null;
  getWidget: (id: string) => { type: string; state: unknown } | null | undefined;
  getWidgetDef: (id: string) => {
    // method 문법(bivariant) — 구체 WidgetDef.onKey(typed ev/state/ctx)를 수용.
    onKey?(ev: unknown, state: unknown, ctx: unknown): unknown;
  } | null | undefined;
  buildWidgetContext: (id: string) => unknown | null | undefined;
  draw: () => void;
}

export function bootDashboardViewTools(
  deps: DashboardViewToolsBootDeps,
): void {
  deps.initDashboardViewTools(
    {
      list: deps.listViews,
      switchTo: deps.switchViewByNeedle,
    },
    {
      sendKey: (id, name, mods) => {
        const inst = deps.getWidget(id);
        if (!inst) return { ok: false, handled: false, reason: `unknown widget id "${id}"` };
        const def = deps.getWidgetDef(id);
        if (!def?.onKey) return { ok: false, handled: false, reason: `widget "${id}" (type ${inst.type}) has no onKey handler` };
        const ev = { name, ctrl: !!mods.ctrl, shift: !!mods.shift, alt: !!mods.alt } as const;
        const result = def.onKey(ev, inst.state, deps.buildWidgetContext(id));
        deps.draw();
        const handled = !!result && typeof result === 'object' && 'type' in result
          && (
            result.type === 'refresh'
            || result.type === 'submit'
            || result.type === 'focus'
            || result.type === 'deactivate'
          );
        return { ok: true, handled };
      },
      snapshot: (id) => {
        const inst = deps.getWidget(id);
        if (!inst) return null;
        return { type: inst.type, state: inst.state };
      },
    },
  );
}
