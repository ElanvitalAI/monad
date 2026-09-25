import { createBrowserPaneModel, type BrowserPaneModel } from './model.js';

export function cloneBrowserPaneModel(src: BrowserPaneModel): BrowserPaneModel {
  return {
    cwd: src.cwd,
    entries: src.entries.slice(),
    cursor: src.cursor,
    offset: src.offset,
    selected: new Set(src.selected),
    sortMode: src.sortMode,
    showHidden: src.showHidden,
    remote: src.remote ? { host: src.remote.host, cwd: src.remote.cwd } : null,
  };
}

export class BrowserPaneRegistry {
  private readonly states = new Map<string, BrowserPaneModel>();

  register(id: string, state: BrowserPaneModel): void {
    this.states.set(id, state);
  }

  get(id: string): BrowserPaneModel | null {
    return this.states.get(id) ?? null;
  }

  ensure(id: string, opts?: { cwd?: string }): BrowserPaneModel {
    const existing = this.states.get(id);
    if (existing) return existing;
    const next = createBrowserPaneModel(opts?.cwd);
    this.states.set(id, next);
    return next;
  }

  cloneInto(srcId: string, dstId: string): BrowserPaneModel {
    const src = this.states.get(srcId);
    if (!src) {
      throw new Error(`BrowserPaneRegistry.cloneInto: source id "${srcId}" is not registered`);
    }
    const clone = cloneBrowserPaneModel(src);
    this.states.set(dstId, clone);
    return clone;
  }

  delete(id: string): boolean {
    return this.states.delete(id);
  }

  size(): number {
    return this.states.size;
  }

  ids(): string[] {
    return [...this.states.keys()];
  }
}
