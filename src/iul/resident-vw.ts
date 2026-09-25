import type { WindowRegistry } from '../virtual-windows/window-registry.js';
import {
  bootResidentWindow,
  ensureResidentWindowSpawned,
  findResidentWindowByTitle,
  focusOrSpawnResidentWindow,
} from '../virtual-windows/resident-window.js';

export const IUL_RESIDENT_WINDOW_TITLE = 'IUL UX Lab';
export const IUL_SHELL_PANE_TITLE = 'IUL UX Lab';

export function isIulResidentEnabled(vw: { iulResident?: boolean; entries?: Partial<Record<'iul', { resident?: boolean }>> }): boolean {
  const resident = vw.entries?.iul?.resident;
  return resident !== undefined ? resident === true : vw.iulResident === true;
}

export function isIulForegroundStartupEnabled(vw: { iulForegroundOnStartup?: boolean; entries?: Partial<Record<'iul', { foregroundOnStartup?: boolean }>> }): boolean {
  const foreground = vw.entries?.iul?.foregroundOnStartup;
  return foreground !== undefined ? foreground === true : vw.iulForegroundOnStartup === true;
}

export function findIulResidentWindow(
  registry: Pick<WindowRegistry, 'list' | 'spawnTitleOf'>,
) {
  return findResidentWindowByTitle(registry, IUL_RESIDENT_WINDOW_TITLE);
}

export function focusOrSpawnIulResidentWindow(
  registry: Pick<WindowRegistry, 'spawn' | 'switchTo' | 'list' | 'spawnTitleOf'>,
): number {
  return focusOrSpawnResidentWindow(registry, {
    title: IUL_RESIDENT_WINDOW_TITLE,
    initialContent: { kind: 'iul-shell', title: IUL_SHELL_PANE_TITLE } as any,
  });
}

export function ensureIulResidentWindowSpawned(
  registry: Pick<WindowRegistry, 'spawn' | 'list' | 'spawnTitleOf'>,
): number {
  return ensureResidentWindowSpawned(registry, {
    title: IUL_RESIDENT_WINDOW_TITLE,
    initialContent: { kind: 'iul-shell', title: IUL_SHELL_PANE_TITLE } as any,
  });
}

export function bootIulResidentWindow(
  registry: Pick<WindowRegistry, 'spawn' | 'switchTo' | 'list' | 'spawnTitleOf'>,
  opts: { foreground?: boolean } = {},
): number {
  return bootResidentWindow(registry, {
    title: IUL_RESIDENT_WINDOW_TITLE,
    initialContent: { kind: 'iul-shell', title: IUL_SHELL_PANE_TITLE } as any,
    bootMode: opts.foreground ? 'foreground' : 'background',
  });
}
