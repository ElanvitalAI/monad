import type { TerminalPlacement } from './types.js';

export interface VwBindingRef {
  bindingKey: string;
  windowId: string;
  slotId: string;
}

export interface VwPlacedTerminalLike {
  id: string;
  exitCode: number | null;
  placement: TerminalPlacement;
}

export function findBindingsForPaneClose(
  bindings: ReadonlyMap<string, string>,
  paneId: string,
): VwBindingRef[] {
  const out: VwBindingRef[] = [];
  for (const [bindingKey, value] of bindings.entries()) {
    if (value !== paneId) continue;
    const slash = bindingKey.indexOf('/');
    if (slash <= 0) continue;
    out.push({
      bindingKey,
      windowId: bindingKey.slice(0, slash),
      slotId: bindingKey.slice(slash + 1),
    });
  }
  return out;
}

export function findLiveVwTerminalIdsForBindings(
  terminals: Iterable<VwPlacedTerminalLike>,
  bindings: readonly VwBindingRef[],
): string[] {
  if (bindings.length === 0) return [];
  const wanted = new Set(bindings.map(b => `${b.windowId}/${b.slotId}`));
  const out: string[] = [];
  for (const terminal of terminals) {
    if (terminal.exitCode !== null) continue;
    if (terminal.placement.kind !== 'vw') continue;
    const key = `${terminal.placement.windowId}/${terminal.placement.slotId}`;
    if (wanted.has(key)) out.push(terminal.id);
  }
  return out;
}

export function findLiveVwTerminalIdsForWindow(
  terminals: Iterable<VwPlacedTerminalLike>,
  windowId: string,
): string[] {
  const out: string[] = [];
  for (const terminal of terminals) {
    if (terminal.exitCode !== null) continue;
    if (terminal.placement.kind !== 'vw') continue;
    if (terminal.placement.windowId === windowId) out.push(terminal.id);
  }
  return out;
}
