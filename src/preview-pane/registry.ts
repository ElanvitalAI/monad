import { createPreviewPaneModel, type PreviewPaneModel } from './model.js';

export function clonePreviewPaneModel(src: PreviewPaneModel): PreviewPaneModel {
  return {
    ...src,
    previewLines: src.previewLines.slice(),
  };
}

export class PreviewPaneRegistry {
  private readonly states = new Map<string, PreviewPaneModel>();

  register(id: string, state: PreviewPaneModel): void {
    this.states.set(id, state);
  }

  get(id: string): PreviewPaneModel | null {
    return this.states.get(id) ?? null;
  }

  ensure(id: string, opts?: Parameters<typeof createPreviewPaneModel>[1]): PreviewPaneModel {
    const existing = this.states.get(id);
    if (existing) return existing;
    const next = createPreviewPaneModel(id, opts);
    this.states.set(id, next);
    return next;
  }

  cloneInto(srcId: string, dstId: string): PreviewPaneModel {
    const src = this.states.get(srcId);
    if (!src) {
      throw new Error(`PreviewPaneRegistry.cloneInto: source id "${srcId}" is not registered`);
    }
    const clone = clonePreviewPaneModel(src);
    clone.id = dstId;
    this.states.set(dstId, clone);
    return clone;
  }

  delete(id: string): boolean {
    return this.states.delete(id);
  }
}
