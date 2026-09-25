import { describe, expect, test } from 'bun:test';

import { createDashboardChatMainAtCandidateOpts } from '../src/dashboard/input/chat-main-at-candidate-opts.js';

describe('dashboard chat main @ candidate opts', () => {
  const baseDeps = {
    baseCwd: () => '/repo',
    readRootEntries: () => [
      { name: 'src', absPath: '/repo/src', isDir: true },
      { name: 'README.md', absPath: '/repo/README.md', isDir: false, size: 42 },
    ],
    listDirEntries: () => [
      { name: 'index.ts', absPath: '/repo/src/index.ts', isDir: false, size: 11 },
    ],
    splitAtPrefix: (prefix) => ({ dir: `/repo/${prefix.slice(0, -1)}`, partial: '' }),
    searchIndex: (_cwd, prefix) => [{ path: `src/${prefix}.ts` }],
    absolutize: (path, cwd) => `${cwd}/${path}`,
    formatEntry: (entry, label) => ({
      label,
      absPath: entry.absPath,
      isDir: entry.isDir,
      icon: entry.isDir ? 'dir' : 'file',
      hint: entry.isDir ? '' : String(entry.size ?? ''),
    }),
    formatSearchResult: (result, cwd) => ({
      label: result.path,
      absPath: `${cwd}/${result.path}`,
      isDir: false,
      icon: 'file',
      hint: '',
    }),
  };
  const opts = createDashboardChatMainAtCandidateOpts(baseDeps);

  test('lists cwd entries when prefix is empty', async () => {
    await expect(opts.onAtCandidates?.('')).resolves.toEqual([
      { label: 'src/', absPath: '/repo/src', isDir: true, icon: 'dir', hint: '' },
      { label: 'README.md', absPath: '/repo/README.md', isDir: false, icon: 'file', hint: '42' },
    ]);
  });

  test('lists direct children when prefix descends into a directory', async () => {
    await expect(opts.onAtCandidates?.('src/')).resolves.toEqual([
      { label: 'src/index.ts', absPath: '/repo/src/index.ts', isDir: false, icon: 'file', hint: '11' },
    ]);
  });

  test('falls back to fuzzy search for non-directory prefixes', async () => {
    await expect(opts.onAtCandidates?.('chat')).resolves.toEqual([
      { label: 'src/chat.ts', absPath: '/repo/src/chat.ts', isDir: false, icon: 'file', hint: '' },
    ]);
  });

  test('returns an empty list when split or directory read fails', async () => {
    const failing = createDashboardChatMainAtCandidateOpts({
      ...baseDeps,
      splitAtPrefix: () => { throw new Error('bad prefix'); },
      listDirEntries: () => { throw new Error('bad dir'); },
    });

    await expect(failing.onAtCandidates?.('src/')).resolves.toEqual([]);
  });
});
