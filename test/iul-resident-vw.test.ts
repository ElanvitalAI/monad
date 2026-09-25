import { describe, expect, test } from 'bun:test';

import {
  bootIulResidentWindow,
  ensureIulResidentWindowSpawned,
  findIulResidentWindow,
  focusOrSpawnIulResidentWindow,
  IUL_RESIDENT_WINDOW_TITLE,
  IUL_SHELL_PANE_TITLE,
  isIulResidentEnabled,
} from '../src/iul/resident-vw.js';

describe('iul resident VW helper', () => {
  test('isIulResidentEnabled is explicit opt-in only', () => {
    expect(isIulResidentEnabled({ iulResident: true })).toBe(true);
    expect(isIulResidentEnabled({})).toBe(false);
    expect(isIulResidentEnabled({ iulResident: false })).toBe(false);
  });

  test('focusOrSpawnIulResidentWindow focuses existing resident instead of respawning', () => {
    const existing = { id: 21, title: IUL_RESIDENT_WINDOW_TITLE };
    const switched: number[] = [];
    const id = focusOrSpawnIulResidentWindow({
      list: () => [existing],
      spawnTitleOf: (windowId: number) => (windowId === 21 ? IUL_RESIDENT_WINDOW_TITLE : null),
      switchTo: (next) => { switched.push(next); return true; },
      spawn: () => { throw new Error('should not spawn'); },
    } as any);
    expect(findIulResidentWindow({
      list: () => [existing],
      spawnTitleOf: (windowId: number) => (windowId === 21 ? IUL_RESIDENT_WINDOW_TITLE : null),
    } as any)?.id).toBe(21);
    expect(id).toBe(21);
    expect(switched).toEqual([21]);
  });

  test('ensureIulResidentWindowSpawned keeps IUL resident in background', () => {
    const spawned: Array<{ title: string; initialContent: { kind: string; title: string }; foreground?: boolean }> = [];
    const id = ensureIulResidentWindowSpawned({
      list: () => [],
      spawnTitleOf: () => null,
      spawn: (spec) => {
        spawned.push(spec as any);
        return { id: 22 } as any;
      },
    } as any);
    expect(id).toBe(22);
    expect(spawned).toEqual([
      {
        title: IUL_RESIDENT_WINDOW_TITLE,
        initialContent: { kind: 'iul-shell', title: IUL_SHELL_PANE_TITLE },
        foreground: false,
      },
    ]);
  });

  test('bootIulResidentWindow defaults to background so startup stays on main', () => {
    const switched: number[] = [];
    const spawned: Array<{ title: string; initialContent: { kind: string; title: string }; foreground?: boolean }> = [];
    const id = bootIulResidentWindow({
      list: () => [],
      spawnTitleOf: () => null,
      switchTo: (next) => { switched.push(next); return true; },
      spawn: (spec) => {
        spawned.push(spec as any);
        return { id: 23 } as any;
      },
    } as any);
    expect(id).toBe(23);
    expect(switched).toEqual([]);
    expect(spawned).toEqual([
      {
        title: IUL_RESIDENT_WINDOW_TITLE,
        initialContent: { kind: 'iul-shell', title: IUL_SHELL_PANE_TITLE },
        foreground: false,
      },
    ]);
  });
});
