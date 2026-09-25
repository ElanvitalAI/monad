import { describe, expect, test } from 'bun:test';

import {
  bootSimResidentWindow,
  ensureSimResidentWindowSpawned,
  SIM_RESIDENT_WINDOW_TITLE,
  SIM_SHELL_PANE_TITLE,
  findSimResidentWindow,
  focusOrSpawnSimResidentWindow,
  isSimResidentEnabled,
} from '../src/sim/resident-vw.js';

describe('sim resident VW helper', () => {
  test('isSimResidentEnabled is explicit opt-in only', () => {
    expect(isSimResidentEnabled({ simResident: true })).toBe(true);
    expect(isSimResidentEnabled({})).toBe(false);
    expect(isSimResidentEnabled({ simResident: false })).toBe(false);
  });

  test('focusOrSpawnSimResidentWindow focuses existing resident instead of respawning', () => {
    const existing = { id: 9, title: 'Simulator' };
    const switched: number[] = [];
    const id = focusOrSpawnSimResidentWindow({
      list: () => [existing],
      spawnTitleOf: (windowId: number) => (windowId === 9 ? SIM_RESIDENT_WINDOW_TITLE : null),
      switchTo: (next) => { switched.push(next); return true; },
      spawn: () => { throw new Error('should not spawn'); },
    } as any);
    expect(findSimResidentWindow({
      list: () => [existing],
      spawnTitleOf: (windowId: number) => (windowId === 9 ? SIM_RESIDENT_WINDOW_TITLE : null),
    } as any)?.id).toBe(9);
    expect(id).toBe(9);
    expect(switched).toEqual([9]);
  });

  test('focusOrSpawnSimResidentWindow spawns simulator when missing', () => {
    const spawned: Array<{ title: string; initialContent: { kind: string; title: string } }> = [];
    const id = focusOrSpawnSimResidentWindow({
      list: () => [],
      spawnTitleOf: () => null,
      switchTo: () => true,
      spawn: (spec) => {
        spawned.push(spec as any);
        return { id: 12 } as any;
      },
    } as any);
    expect(id).toBe(12);
    expect(spawned).toEqual([
      {
        title: SIM_RESIDENT_WINDOW_TITLE,
        initialContent: { kind: 'sim-shell', title: SIM_SHELL_PANE_TITLE },
      },
    ]);
  });

  test('ensureSimResidentWindowSpawned keeps simulator resident in background', () => {
    const spawned: Array<{ title: string; initialContent: { kind: string; title: string }; foreground?: boolean }> = [];
    const id = ensureSimResidentWindowSpawned({
      list: () => [],
      spawnTitleOf: () => null,
      spawn: (spec) => {
        spawned.push(spec as any);
        return { id: 15 } as any;
      },
    } as any);
    expect(id).toBe(15);
    expect(spawned).toEqual([
      {
        title: SIM_RESIDENT_WINDOW_TITLE,
        initialContent: { kind: 'sim-shell', title: SIM_SHELL_PANE_TITLE },
        foreground: false,
      },
    ]);
  });

  test('bootSimResidentWindow defaults to background so startup stays on main', () => {
    const switched: number[] = [];
    const spawned: Array<{ title: string; initialContent: { kind: string; title: string }; foreground?: boolean }> = [];
    const id = bootSimResidentWindow({
      list: () => [],
      spawnTitleOf: () => null,
      switchTo: (next) => { switched.push(next); return true; },
      spawn: (spec) => {
        spawned.push(spec as any);
        return { id: 16 } as any;
      },
    } as any);
    expect(id).toBe(16);
    expect(switched).toEqual([]);
    expect(spawned).toEqual([
      {
        title: SIM_RESIDENT_WINDOW_TITLE,
        initialContent: { kind: 'sim-shell', title: SIM_SHELL_PANE_TITLE },
        foreground: false,
      },
    ]);
  });
});
