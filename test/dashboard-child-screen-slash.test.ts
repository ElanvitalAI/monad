import { describe, expect, test } from 'bun:test';
import {
  buildDashboardSlashRegistry,
  type DashboardSlashContext,
} from '../src/dashboard/slash-runtime/index.js';
import { listDashboardChildScreens } from '../src/dashboard/index.js';

type Row = { id: string; kind: string; runId: string; alive: boolean; manifestDbPath?: string };

function makeContext(rows: readonly Row[], snapshot: (id: string, manifestDbPath: string) => Promise<{ exitCode: number; message: string }>, runId = 'run-current') {
  return makeContextWithList(() => rows.map((row) => ({ ...row, manifestDbPath: row.manifestDbPath ?? '/manifest/current.db' })), snapshot, runId);
}

function makeContextWithList(list: () => readonly Row[], snapshot: (id: string, manifestDbPath: string) => Promise<{ exitCode: number; message: string }>, runId = 'run-current') {
  const modals: Array<{ title: string; lines: readonly string[] }> = [];
  const ctx = {
    chatLines: [],
    childScreen: {
      runId: () => runId,
      list,
      snapshot,
      show: (modal: { title: string; lines: readonly string[] }) => { modals.push(modal); },
    },
    setChatScrollOffset: () => {},
    warning: (text: string) => text,
  } as unknown as DashboardSlashContext;
  return { ctx, modals };
}

async function dispatchChild(rows: readonly Row[], snapshot: (id: string, manifestDbPath: string) => Promise<{ exitCode: number; message: string }>, runId?: string) {
  const { ctx, modals } = makeContext(rows, snapshot, runId);
  const outcome = await buildDashboardSlashRegistry().dispatch('child', [], ctx);
  expect(outcome).toEqual({ kind: 'continue' });
  expect(modals).toHaveLength(1);
  return modals[0]!;
}

describe('/child harness screen slash', () => {
  test('includes an isolated-root live child in the dashboard list and opens its screen', async () => {
    const isolatedManifest = '/monad-test/pty/manifest.db';
    const calls: Array<{ includeTest?: boolean }> = [];
    const isolatedRow = {
      id: 'self_isolated',
      kind: 'self',
      runId: 'run-current',
      alive: true,
      providerOnly: 'must-not-reach-child-screen',
    };
    const rows = listDashboardChildScreens({
      manifestTargets: (opts) => {
        calls.push(opts);
        return opts.includeTest === true ? [{ dbPath: isolatedManifest }] : [];
      },
      listManifestRowsAt: (dbPath) => dbPath === isolatedManifest ? [
        isolatedRow,
        { id: 'self_foreign', kind: 'self', runId: 'other-run', alive: true },
      ] : [],
    });
    const { ctx, modals } = makeContextWithList(() => rows, async (id, manifestDbPath) => ({ exitCode: 0, message: `${id} from ${manifestDbPath}` }));

    const outcome = await buildDashboardSlashRegistry().dispatch('child', [], ctx);

    expect(outcome).toEqual({ kind: 'continue' });
    expect(calls).toEqual([{ includeTest: true }]);
    expect(rows).toEqual([
      { id: 'self_isolated', kind: 'self', runId: 'run-current', alive: true, manifestDbPath: isolatedManifest },
      { id: 'self_foreign', kind: 'self', runId: 'other-run', alive: true, manifestDbPath: isolatedManifest },
    ]);
    expect(rows[0]).not.toHaveProperty('providerOnly');
    expect(modals).toHaveLength(1);
    expect(modals[0]!.title).toContain('self_isolated');
    expect(modals[0]!.lines).toEqual([`self_isolated from ${isolatedManifest}`]);
    expect(modals[0]!.lines.join('\n')).not.toContain('찾지 못했습니다');
    expect(modals[0]!.lines.join('\n')).not.toContain('self_foreign');
  });

  test('registers /child and chooses the live self_ child over the parent in the same run', async () => {
    const modal = await dispatchChild([
      { id: 'pty_parent', kind: 'tui', runId: 'run-current', alive: true },
      { id: 'self_wrong_kind', kind: 'tui', runId: 'run-current', alive: true },
      { id: 'pty_wrong_prefix', kind: 'self', runId: 'run-current', alive: true },
      { id: 'self_child', kind: 'self', runId: 'run-current', alive: true },
    ], async (id, manifestDbPath) => ({ exitCode: 0, message: `screen for ${id} from ${manifestDbPath}` }));
    expect(modal.title).toContain('self_child');
    expect(modal.lines).toEqual(['screen for self_child from /manifest/current.db']);
    const registry = buildDashboardSlashRegistry();
    expect(registry.has('child')).toBe(true);
    expect(registry.isImmediateDuringStream('child')).toBe(true);
    expect(registry.isImmediateDuringStream('usage')).toBe(false);
  });

  test('chooses an isolated-root live child and rejects a foreign run', async () => {
    const isolatedManifest = '/monad-test/pty/manifest.db';
    const modal = await dispatchChild([
      { id: 'self_ended', kind: 'self', runId: 'run-current', alive: false },
      { id: 'self_isolated', kind: 'self', runId: 'run-current', alive: true, manifestDbPath: isolatedManifest },
      { id: 'self_foreign', kind: 'self', runId: 'other-run', alive: true, manifestDbPath: isolatedManifest },
    ], async (id, manifestDbPath) => ({ exitCode: 0, message: `${id} from ${manifestDbPath}` }));
    expect(modal.title).toContain('self_isolated');
    expect(modal.lines).toEqual([`self_isolated from ${isolatedManifest}`]);
    expect(modal.lines.join('\n')).not.toContain('찾지 못했습니다');
    expect(modal.lines.join('\n')).not.toContain('self_foreign');
  });

  test('distinguishes ended matching children from no matching candidates', async () => {
    const ended = await dispatchChild([
      { id: 'self_done', kind: 'self', runId: 'run-current', alive: false },
    ], async () => ({ exitCode: 0, message: 'unreachable' }));
    expect(ended.lines.join('\n')).toContain('모두 끝났습니다');

    const missing = await dispatchChild([], async () => ({ exitCode: 0, message: 'unreachable' }));
    expect(missing.lines.join('\n')).toContain('run-current');
    expect(missing.lines.join('\n')).toContain('runId + kind=self + self_');
  });

  test('lists live ambiguity, contains capture failure, and annotates truncation', async () => {
    const ambiguous = await dispatchChild([
      { id: 'self_one', kind: 'self', runId: 'run-current', alive: true },
      { id: 'self_two', kind: 'self', runId: 'run-current', alive: true },
    ], async () => ({ exitCode: 0, message: 'unreachable' }));
    expect(ambiguous.lines.join('\n')).toContain('self_one');
    expect(ambiguous.lines.join('\n')).toContain('self_two');

    const failed = await dispatchChild([{ id: 'self_failed', kind: 'self', runId: 'run-current', alive: true }], async () => ({ exitCode: 1, message: 'pty snapshot: owner has exited' }));
    expect(failed.lines.join('\n')).toContain('읽지 못했습니다');
    expect(failed.lines.join('\n')).toContain('owner has exited');

    const empty = await dispatchChild([{ id: 'self_empty', kind: 'self', runId: 'run-current', alive: true }], async () => ({ exitCode: 0, message: '' }));
    expect(empty.lines).toEqual(['화면 캡처가 비어 있습니다.']);

    const longScreen = Array.from({ length: 41 }, (_, index) => `line ${index}`).join('\n');
    const truncated = await dispatchChild([{ id: 'self_long', kind: 'self', runId: 'run-current', alive: true }], async () => ({ exitCode: 0, message: longScreen }));
    expect(truncated.lines).toHaveLength(41);
    expect(truncated.lines.at(-1)).toContain('잘렸습니다');
  });

  test('contains thrown capture errors without leaking them to the input loop', async () => {
    const modal = await dispatchChild([{ id: 'self_throw', kind: 'self', runId: 'run-current', alive: true }], async () => { throw new Error('remote unavailable'); });
    expect(modal.lines.join('\n')).toContain('화면 읽기에 실패했습니다');
    expect(modal.lines.join('\n')).toContain('remote unavailable');
  });
});
