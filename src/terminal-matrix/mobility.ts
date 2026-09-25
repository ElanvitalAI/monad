import type { TerminalInstance, TerminalPlacement } from './types.js';

export function resolveVwTerminalInstanceForPane(
  instances: readonly TerminalInstance[],
  bindings: ReadonlyMap<string, string>,
  windowId: string,
  paneId: string,
): TerminalInstance | null {
  for (const instance of instances) {
    if (instance.placement.kind !== 'vw') continue;
    if (instance.placement.windowId !== windowId) continue;
    const bindingKey = `${windowId}/${instance.placement.slotId}`;
    const actualPaneId = bindings.get(bindingKey) ?? instance.placement.slotId;
    if (actualPaneId === paneId) return instance;
  }
  return null;
}

export interface ResolveTerminalMoveDestinationOpts {
  currentVwWindowId?: string | null;
  vwSlotId?: string | null;
  modalId?: string | null;
}

export function resolveTerminalMoveDestination(
  destRaw: string,
  opts: ResolveTerminalMoveDestinationOpts,
): TerminalPlacement | null {
  const normalized = destRaw.trim().toLowerCase();
  if (normalized === 'bg' || normalized === 'background') return { kind: 'background' };
  if (normalized === 'modal') {
    return opts.modalId ? { kind: 'modal', modalId: opts.modalId } : null;
  }
  if (normalized === 'preview') return { kind: 'preview' };
  if (normalized === 'vw' || normalized === 'window') {
    if (!opts.currentVwWindowId || !opts.vwSlotId) return null;
    return {
      kind: 'vw',
      windowId: opts.currentVwWindowId,
      slotId: opts.vwSlotId,
    };
  }
  return null;
}
