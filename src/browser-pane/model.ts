import { readdirSync, statSync, type Stats } from 'fs';
import { join, resolve, dirname, basename } from 'path';
import { homedir } from 'os';

import type { FileSortMode } from '../workspace-types.js';

export interface FsEntry {
  name: string;
  absPath: string;
  isDir: boolean;
  size: number;
  mtime: number;
  ext: string;
}

export interface BrowserPaneModel {
  cwd: string;
  entries: FsEntry[];
  cursor: number;
  offset: number;
  selected: Set<string>;
  sortMode: FileSortMode;
  showHidden: boolean;
  remote?: {
    host: import('../ssh/ssh-hosts.js').SshHost;
    cwd: string;
  } | null;
}

export function createBrowserPaneModel(cwd: string = process.cwd()): BrowserPaneModel {
  return {
    cwd: resolve(cwd),
    entries: [],
    cursor: 0,
    offset: 0,
    selected: new Set(),
    sortMode: 'name',
    showHidden: false,
  };
}

export function resolvePath(input: string, cwd: string = process.cwd()): string {
  if (input === '~' || input === '~/') return homedir();
  if (input.startsWith('~/')) return join(homedir(), input.slice(2));
  if (input.startsWith('/')) return input;
  return resolve(cwd, input);
}

export function splitAtPrefix(prefix: string, cwd: string = process.cwd()): { dir: string; partial: string } {
  if (prefix === '') return { dir: resolve(cwd), partial: '' };

  const endsWithSep = prefix.endsWith('/');
  const trimmed = endsWithSep ? prefix.slice(0, -1) : prefix;
  const slashIdx = trimmed.lastIndexOf('/');
  let dirPart: string;
  let partial: string;
  if (slashIdx < 0) {
    dirPart = '';
    partial = endsWithSep ? trimmed : trimmed;
  } else {
    dirPart = trimmed.slice(0, slashIdx + 1);
    partial = trimmed.slice(slashIdx + 1);
  }

  if (endsWithSep) {
    const fullDir = resolve(resolvePath(prefix, cwd));
    return { dir: fullDir, partial: '' };
  }

  const dir = dirPart === '' ? resolve(cwd) : resolve(resolvePath(dirPart, cwd));
  return { dir, partial };
}

function toEntry(dir: string, name: string, st: Stats): FsEntry {
  const absPath = join(dir, name);
  const isDir = st.isDirectory();
  const dot = name.lastIndexOf('.');
  const ext = !isDir && dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return {
    name,
    absPath,
    isDir,
    size: isDir ? 0 : st.size,
    mtime: Math.floor(st.mtimeMs),
    ext,
  };
}

export function readDirEntries(dir: string, showHidden: boolean): { folders: FsEntry[]; files: FsEntry[] } {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return { folders: [], files: [] };
  }
  const folders: FsEntry[] = [];
  const files: FsEntry[] = [];
  for (const n of names) {
    if (!showHidden && n.startsWith('.')) continue;
    let st: Stats;
    try { st = statSync(join(dir, n)); } catch { continue; }
    const e = toEntry(dir, n, st);
    (e.isDir ? folders : files).push(e);
  }
  return { folders, files };
}

export function sortEntries(entries: FsEntry[], mode: FileSortMode): FsEntry[] {
  const arr = entries.slice();
  const byName = (a: FsEntry, b: FsEntry) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  switch (mode) {
    case 'name':
      arr.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return byName(a, b);
      });
      break;
    case 'mtime':
      arr.sort((a, b) => b.mtime - a.mtime || byName(a, b));
      break;
    case 'type':
      arr.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        if (a.ext !== b.ext) return a.ext.localeCompare(b.ext);
        return byName(a, b);
      });
      break;
    case 'size':
      arr.sort((a, b) => b.size - a.size || byName(a, b));
      break;
  }
  return arr;
}

export function refreshBrowserPane(state: BrowserPaneModel): void {
  const { folders: rawDirs, files: rawFiles } = readDirEntries(state.cwd, state.showHidden);
  const folders = sortEntries(rawDirs, state.sortMode);
  const files = sortEntries(rawFiles, state.sortMode);

  const entries: FsEntry[] = [];
  const parent = dirname(state.cwd);
  if (parent !== state.cwd) {
    entries.push({
      name: '..',
      absPath: parent,
      isDir: true,
      size: 0,
      mtime: 0,
      ext: '',
    });
  }
  entries.push(...folders, ...files);
  state.entries = entries;
  state.cursor = Math.min(state.cursor, Math.max(0, state.entries.length - 1));

  const alive = new Set(state.entries.filter(e => !e.isDir).map(e => e.absPath));
  for (const p of [...state.selected]) {
    if (!alive.has(p)) state.selected.delete(p);
  }
}

export function enterBrowserDirectory(state: BrowserPaneModel, nextCwd: string): void {
  const resolved = resolve(nextCwd);
  state.cwd = resolved;
  state.cursor = 0;
  state.offset = 0;
  state.selected.clear();
}

export function toggleBrowserSelection(state: BrowserPaneModel, cursorIdx: number = state.cursor): number {
  const e = state.entries[cursorIdx];
  if (!e || e.isDir) return state.selected.size;
  if (state.selected.has(e.absPath)) state.selected.delete(e.absPath);
  else state.selected.add(e.absPath);
  return state.selected.size;
}

export function toggleBrowserSelectAll(state: BrowserPaneModel): number {
  const filePaths = state.entries.filter(e => !e.isDir).map(e => e.absPath);
  if (state.selected.size === filePaths.length && filePaths.every(p => state.selected.has(p))) {
    state.selected.clear();
  } else {
    state.selected = new Set(filePaths);
  }
  return state.selected.size;
}

export function browserAttachTargets(state: BrowserPaneModel): string[] {
  if (state.selected.size > 0) return [...state.selected];
  const e = state.entries[state.cursor];
  return e && !e.isDir ? [e.absPath] : [];
}

export function focusedBrowserEntry(state: Pick<BrowserPaneModel, 'entries' | 'cursor'>): FsEntry | null {
  return state.entries[state.cursor] ?? null;
}

export { basename, dirname };
