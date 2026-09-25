import { describe, expect, it } from 'bun:test';
import { stripAnsi } from '../tui.js';
import type { DiffResult } from '../types.js';
import { createRunDiffInline, type RunDiffInlineDeps } from './run-diff-inline.js';

function emptyDiff(skillName: string, server: string, service: string): DiffResult {
  return {
    skillName,
    server,
    service,
    localOnly: [],
    remoteOnly: [],
    modified: [],
    envDeltas: [],
  };
}

function changedDiff(skillName: string, server: string, service: string): DiffResult {
  return {
    ...emptyDiff(skillName, server, service),
    localOnly: ['src/new.ts'],
    remoteOnly: ['gone.ts'],
    modified: [{
      path: 'SKILL.md',
      localHash: 'a',
      remoteHash: 'b',
      diff: '--- a/SKILL.md\n+++ b/SKILL.md\n-old\n+new\n context\n',
    }],
    envDeltas: [{ file: '.env', key: 'TOKEN', localValue: '1', remoteValue: '2', type: 'env_var' }],
  };
}

function makeSync() {
  return {
    selected: {
      0: new Set(['skill-a']),
      1: new Set(['server-a']),
      2: new Set(['svc-a']),
    },
    cursors: { 0: 3, 1: 2, 2: 1 },
    offsets: { 0: 4, 1: 5, 2: 6 },
    focus: 2 as 0 | 1 | 2,
  };
}

function makeDeps(overrides: Partial<Omit<RunDiffInlineDeps, 'sync' | 'chatLines'>> = {}): RunDiffInlineDeps & {
  chatLines: string[];
  sync: ReturnType<typeof makeSync>;
  draws: number;
  saved: Array<Parameters<RunDiffInlineDeps['saveLastSelection']>[0]>;
  pluginState: { busy: boolean };
} {
  const chatLines: string[] = [];
  const sync = makeSync();
  const pluginState = { busy: false };
  const saved: Array<Parameters<RunDiffInlineDeps['saveLastSelection']>[0]> = [];
  let draws = 0;
  const deps: RunDiffInlineDeps & {
    chatLines: string[];
    sync: ReturnType<typeof makeSync>;
    draws: number;
    saved: typeof saved;
    pluginState: { busy: boolean };
  } = {
    chatLines,
    sync,
    pluginHost: { active: () => ({ state: pluginState }) },
    scrollChatToLatestAndDraw: () => { draws += 1; deps.draws = draws; },
    saveLastSelection: (sel) => { saved.push(sel); },
    computeDiff: async (skillName, server, service) => emptyDiff(skillName, server, service),
    summarizeDiff: async () => '',
    isAnalyzerAvailable: () => false,
    draws: 0,
    saved,
    pluginState,
  };
  if (overrides.pluginHost) deps.pluginHost = overrides.pluginHost;
  if (overrides.scrollChatToLatestAndDraw) deps.scrollChatToLatestAndDraw = overrides.scrollChatToLatestAndDraw;
  if (overrides.saveLastSelection) deps.saveLastSelection = overrides.saveLastSelection;
  if (overrides.computeDiff) deps.computeDiff = overrides.computeDiff;
  if (overrides.summarizeDiff) deps.summarizeDiff = overrides.summarizeDiff;
  if (overrides.isAnalyzerAvailable) deps.isAnalyzerAvailable = overrides.isAnalyzerAvailable;
  return deps;
}

function plain(lines: string[]): string {
  return lines.map(stripAnsi).join('\n');
}

describe('createRunDiffInline', () => {
  it('writes identical output, clears sync selection, and redraws without showDashboard', async () => {
    const deps = makeDeps();
    const runDiffInline = createRunDiffInline(deps);

    await runDiffInline(['skill-a'], ['server-a'], ['svc-a']);

    const text = plain(deps.chatLines);
    expect(text).toContain('identical');
    expect(text).toContain('1 identical');
    expect(text).toContain('(sync mode — pick new targets, Esc/q to exit)');
    expect(deps.sync.selected[0]!.size).toBe(0);
    expect(deps.sync.selected[1]!.size).toBe(0);
    expect(deps.sync.cursors[0]).toBe(0);
    expect(deps.sync.cursors[1]).toBe(0);
    expect(deps.sync.cursors[2]).toBe(0);
    expect(deps.sync.offsets[0]).toBe(0);
    expect(deps.sync.focus).toBe(0);
    expect(deps.pluginState.busy).toBe(false);
    expect(deps.draws).toBeGreaterThan(0);
    expect(deps.saved).toHaveLength(1);
    expect(deps.saved[0]!.mode).toBe('diff');
    expect(deps.saved[0]!.skills).toEqual(['skill-a']);
  });

  it('renders local/remote/modified details when computeDiff reports changes', async () => {
    const deps = makeDeps({
      computeDiff: async (skillName, server, service) => changedDiff(skillName, server, service),
    });
    const runDiffInline = createRunDiffInline(deps);

    await runDiffInline(['skill-a'], ['server-a'], ['svc-a']);

    const text = plain(deps.chatLines);
    expect(text).toContain('differs');
    expect(text).toContain('1 local-only: src/new.ts');
    expect(text).toContain('1 remote-only: gone.ts');
    expect(text).toContain('SKILL.md');
    expect(text).toContain('+new');
    expect(text).toContain('1 env delta (hidden)');
    expect(text).toContain('1 differ');
  });

  it('uses sync.selected defaults when called with no arguments', async () => {
    const seen: string[][] = [];
    const deps = makeDeps({
      computeDiff: async (skillName, server, service) => {
        seen.push([skillName, server, service]);
        return emptyDiff(skillName, server, service);
      },
    });
    const runDiffInline = createRunDiffInline(deps);

    await runDiffInline();

    expect(seen).toEqual([['skill-a', 'server-a', 'svc-a']]);
  });

  it('replaces the progress line when computeDiff throws', async () => {
    const deps = makeDeps({
      computeDiff: async () => {
        throw new Error('boom');
      },
    });
    const runDiffInline = createRunDiffInline(deps);

    await runDiffInline(['skill-a'], ['server-a'], ['svc-a']);

    const text = plain(deps.chatLines);
    expect(text).toContain('boom');
    expect(deps.pluginState.busy).toBe(false);
  });
});
