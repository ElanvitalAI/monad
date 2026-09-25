import type { PaneContentSpec } from './pane-content.js';
import type { WindowRegistry } from './window-registry.js';

export interface ResidentWindowSpec {
  title: string;
  initialContent: PaneContentSpec;
  /** Boot-time policy. Repository default is `background` so the
   *  dashboard always lands in `main` unless a resident explicitly
   *  opts into foreground startup. */
  bootMode?: 'background' | 'foreground';
}

type ResidentWindowLookupRegistry = Pick<WindowRegistry, 'list' | 'spawnTitleOf'>;
type ResidentWindowSpawnRegistry = Pick<WindowRegistry, 'spawn' | 'switchTo' | 'list' | 'spawnTitleOf'>;

export function findResidentWindowByTitle(
  registry: ResidentWindowLookupRegistry,
  title: string,
) {
  return registry.list().find((window) => registry.spawnTitleOf(window.id) === title) ?? null;
}

export function focusOrSpawnResidentWindow(
  registry: ResidentWindowSpawnRegistry,
  spec: ResidentWindowSpec,
): number {
  const existing = findResidentWindowByTitle(registry, spec.title);
  if (existing) {
    registry.switchTo(existing.id);
    return existing.id;
  }
  return registry.spawn({
    title: spec.title,
    initialContent: spec.initialContent,
  }).id;
}

export function ensureResidentWindowSpawned(
  registry: Pick<WindowRegistry, 'spawn' | 'list' | 'spawnTitleOf'>,
  spec: ResidentWindowSpec,
): number {
  const existing = findResidentWindowByTitle(registry, spec.title);
  if (existing) return existing.id;
  return registry.spawn({
    title: spec.title,
    initialContent: spec.initialContent,
    foreground: false,
  }).id;
}

export function bootResidentWindow(
  registry: ResidentWindowSpawnRegistry,
  spec: ResidentWindowSpec,
): number {
  if (spec.bootMode === 'foreground') {
    return focusOrSpawnResidentWindow(registry, spec);
  }
  return ensureResidentWindowSpawned(registry, spec);
}
