import { describe, expect, test } from 'bun:test';
import {
  bootResidentWindow,
  ensureResidentWindowSpawned,
  findResidentWindowByTitle,
  focusOrSpawnResidentWindow,
} from '../src/virtual-windows/resident-window.js';

describe('resident window helper', () => {
  test('findResidentWindowByTitle resolves a matching spawn title', () => {
    const match = findResidentWindowByTitle({
      list: () => [{ id: 1, title: 'ACP' }, { id: 2, title: 'Sim Resident' }] as any,
      spawnTitleOf: (windowId: number) => (windowId === 2 ? 'Sim Resident' : 'ACP'),
    } as any, 'Sim Resident');
    expect(match?.id).toBe(2);
  });

  test('focusOrSpawnResidentWindow spawns when missing', () => {
    const switched: number[] = [];
    const spawned: Array<{ title: string; initialContent: { kind: string; title: string } }> = [];
    const id = focusOrSpawnResidentWindow({
      list: () => [],
      spawnTitleOf: () => null,
      switchTo: (next) => { switched.push(next); return true; },
      spawn: (spec) => {
        spawned.push(spec as any);
        return { id: 7 } as any;
      },
    } as any, {
      title: 'Sim Resident',
      initialContent: { kind: 'acp-shell', title: 'Sim Channels' } as any,
    });
    expect(id).toBe(7);
    expect(switched).toEqual([]);
    expect(spawned).toEqual([
      { title: 'Sim Resident', initialContent: { kind: 'acp-shell', title: 'Sim Channels' } },
    ]);
  });

  test('focusOrSpawnResidentWindow focuses an existing resident instead of respawning', () => {
    const existing = { id: 3, title: 'Sim Resident' };
    const switched: number[] = [];
    const id = focusOrSpawnResidentWindow({
      list: () => [existing],
      spawnTitleOf: (windowId: number) => (windowId === 3 ? 'Sim Resident' : null),
      switchTo: (next) => { switched.push(next); return true; },
      spawn: () => { throw new Error('should not spawn'); },
    } as any, {
      title: 'Sim Resident',
      initialContent: { kind: 'acp-shell', title: 'Sim Channels' } as any,
    });
    expect(id).toBe(3);
    expect(switched).toEqual([3]);
  });

  test('ensureResidentWindowSpawned spawns in background when missing', () => {
    const spawned: Array<{ title: string; initialContent: { kind: string; title: string }; foreground?: boolean }> = [];
    const id = ensureResidentWindowSpawned({
      list: () => [],
      spawnTitleOf: () => null,
      spawn: (spec) => {
        spawned.push(spec as any);
        return { id: 9 } as any;
      },
    } as any, {
      title: 'Sim Resident',
      initialContent: { kind: 'acp-shell', title: 'Sim Channels' } as any,
    });
    expect(id).toBe(9);
    expect(spawned).toEqual([
      {
        title: 'Sim Resident',
        initialContent: { kind: 'acp-shell', title: 'Sim Channels' },
        foreground: false,
      },
    ]);
  });

  test('bootResidentWindow defaults to background so startup stays on main', () => {
    const switched: number[] = [];
    const spawned: Array<{ title: string; initialContent: { kind: string; title: string }; foreground?: boolean }> = [];
    const id = bootResidentWindow({
      list: () => [],
      spawnTitleOf: () => null,
      switchTo: (next) => { switched.push(next); return true; },
      spawn: (spec) => {
        spawned.push(spec as any);
        return { id: 13 } as any;
      },
    } as any, {
      title: 'Sim Resident',
      initialContent: { kind: 'acp-shell', title: 'Sim Channels' } as any,
    });
    expect(id).toBe(13);
    expect(switched).toEqual([]);
    expect(spawned).toEqual([
      {
        title: 'Sim Resident',
        initialContent: { kind: 'acp-shell', title: 'Sim Channels' },
        foreground: false,
      },
    ]);
  });

  test('bootResidentWindow can opt into foreground startup explicitly', () => {
    const switched: number[] = [];
    const spawned: Array<{ title: string; initialContent: { kind: string; title: string }; foreground?: boolean }> = [];
    const id = bootResidentWindow({
      list: () => [],
      spawnTitleOf: () => null,
      switchTo: (next) => { switched.push(next); return true; },
      spawn: (spec) => {
        spawned.push(spec as any);
        return { id: 14 } as any;
      },
    } as any, {
      title: 'Focused Resident',
      initialContent: { kind: 'acp-shell', title: 'Focused Channels' } as any,
      bootMode: 'foreground',
    });
    expect(id).toBe(14);
    expect(switched).toEqual([]);
    expect(spawned).toEqual([
      {
        title: 'Focused Resident',
        initialContent: { kind: 'acp-shell', title: 'Focused Channels' },
      },
    ]);
  });
});
