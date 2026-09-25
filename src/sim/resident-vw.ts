import type { WindowRegistry } from '../virtual-windows/window-registry.js';
import {
  bootResidentWindow,
  ensureResidentWindowSpawned,
  findResidentWindowByTitle,
  focusOrSpawnResidentWindow,
} from '../virtual-windows/resident-window.js';

export const SIM_RESIDENT_WINDOW_TITLE = 'Simulator';
export const SIM_SHELL_PANE_TITLE = 'Test Simulator';

export function isSimResidentEnabled(vw: { simResident?: boolean; entries?: Partial<Record<'sim', { resident?: boolean }>> }): boolean {
  const resident = vw.entries?.sim?.resident;
  return resident !== undefined ? resident === true : vw.simResident === true;
}

export function findSimResidentWindow(
  registry: Pick<WindowRegistry, 'list' | 'spawnTitleOf'>,
) {
  return findResidentWindowByTitle(registry, SIM_RESIDENT_WINDOW_TITLE);
}

export function focusOrSpawnSimResidentWindow(
  registry: Pick<WindowRegistry, 'spawn' | 'switchTo' | 'list' | 'spawnTitleOf'>,
): number {
  return focusOrSpawnResidentWindow(registry, {
    title: SIM_RESIDENT_WINDOW_TITLE,
    initialContent: { kind: 'sim-shell', title: SIM_SHELL_PANE_TITLE } as any,
  });
}

export function ensureSimResidentWindowSpawned(
  registry: Pick<WindowRegistry, 'spawn' | 'list' | 'spawnTitleOf'>,
): number {
  return ensureResidentWindowSpawned(registry, {
    title: SIM_RESIDENT_WINDOW_TITLE,
    initialContent: { kind: 'sim-shell', title: SIM_SHELL_PANE_TITLE } as any,
  });
}

export function bootSimResidentWindow(
  registry: Pick<WindowRegistry, 'spawn' | 'switchTo' | 'list' | 'spawnTitleOf'>,
): number {
  return bootResidentWindow(registry, {
    title: SIM_RESIDENT_WINDOW_TITLE,
    initialContent: { kind: 'sim-shell', title: SIM_SHELL_PANE_TITLE } as any,
  });
}
