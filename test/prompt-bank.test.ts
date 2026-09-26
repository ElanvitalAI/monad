import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPromptBankStore } from '../src/prompt-bank/store.js';
import { selectPromptFragments } from '../src/prompt-bank/selector.js';
import { buildPromptInjection, composeSlots } from '../src/prompt-bank/pipeline.js';
import { renderPromptInjectionForSystemAddendum, renderPromptInjectionForUser } from '../src/prompt-bank/render.js';
import type { PromptBankStore, PromptFragment } from '../src/prompt-bank/types.js';

let root = '';
let store: PromptBankStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'elanous-prompt-bank-test-'));
  store = openPromptBankStore(join(root, 'prompt-bank.sqlite'));
});

afterEach(() => {
  store.close?.();
  rmSync(root, { recursive: true, force: true });
});

function create(overrides: Partial<PromptFragment> = {}): PromptFragment {
  return store.create({
    id: overrides.id,
    name: overrides.name ?? 'Debug view guidance',
    scope: overrides.scope ?? 'global',
    owner: overrides.owner ?? 'builtin',
    kind: overrides.kind ?? 'instruction',
    targetSlot: overrides.targetSlot ?? 'context',
    priority: overrides.priority ?? 100,
    enabled: overrides.enabled,
    content: overrides.content ?? 'Use the native debug panes before guessing.',
    description: overrides.description,
    tags: overrides.tags,
    triggers: overrides.triggers,
    constraints: overrides.constraints,
    metadata: overrides.metadata,
  });
}

describe('PromptBankStore', () => {
  test('creates and reads a prompt fragment', () => {
    const fragment = create({ id: 'builtin.debug', tags: ['debug', 'view'] });
    const loaded = store.get(fragment.id);
    expect(loaded).toMatchObject({
      id: 'builtin.debug',
      name: 'Debug view guidance',
      scope: 'global',
      owner: 'builtin',
      kind: 'instruction',
      targetSlot: 'context',
      enabled: true,
      tags: ['debug', 'view'],
      useCount: 0,
    });
  });

  test('searches by text, metadata filters, and tags', () => {
    create({ id: 'builtin.debug', tags: ['debug'], content: 'Open debug view.' });
    create({ id: 'plugin.pos', name: 'POS control', owner: 'plugin:pos', scope: 'plugin', tags: ['pos'], content: 'POS control rules.' });
    expect(store.search({ query: 'debug' }).map(p => p.id)).toEqual(['builtin.debug']);
    expect(store.search({ owner: 'plugin:pos' }).map(p => p.id)).toEqual(['plugin.pos']);
    expect(store.search({ tags: ['pos'] }).map(p => p.id)).toEqual(['plugin.pos']);
  });

  test('updates, disables, and records usage', () => {
    create({ id: 'builtin.debug' });
    const updated = store.update('builtin.debug', { priority: 5, content: 'Updated prompt' });
    expect(updated.priority).toBe(5);
    expect(updated.content).toBe('Updated prompt');
    expect(store.setEnabled('builtin.debug', false).enabled).toBe(false);
    store.recordUse(['builtin.debug'], '2026-04-16T00:00:00.000Z');
    const loaded = store.get('builtin.debug')!;
    expect(loaded.useCount).toBe(1);
    expect(loaded.lastUsedAt).toBe('2026-04-16T00:00:00.000Z');
  });

  test('persists through reopen', () => {
    const path = join(root, 'reopen.sqlite');
    const first = openPromptBankStore(path);
    first.create({
      id: 'persisted',
      name: 'Persisted',
      scope: 'project',
      owner: 'project',
      kind: 'instruction',
      targetSlot: 'context',
      content: 'Persist me.',
    });
    first.close?.();
    const second = openPromptBankStore(path);
    expect(second.get('persisted')?.content).toBe('Persist me.');
    second.close?.();
  });

  test('records and lists prompt injection logs', () => {
    const log = store.recordInjection({
      id: 'inject-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      model: 'gpt-test',
      activeView: 'debug',
      selectedFragmentIds: ['debug'],
      rejected: [{ id: 'future', reason: 'trigger:unsupported:future' }],
      tokenEstimate: 12,
      slots: { context: 'Debug context' },
      metadata: { focusedPane: 'debug-events' },
    });
    expect(log.id).toBe('inject-1');
    expect(store.getInjectionLog('inject-1')).toMatchObject({
      sessionId: 'session-1',
      selectedFragmentIds: ['debug'],
      slots: { context: 'Debug context' },
    });
    expect(store.listInjectionLogs(1).map(item => item.id)).toEqual(['inject-1']);
  });
});

describe('selectPromptFragments', () => {
  test('selects enabled fragments whose triggers match runtime state', () => {
    const debug = create({
      id: 'debug',
      priority: 10,
      triggers: { view: 'debug', paneVisible: 'debug-events', intent: ['inspect', 'debug'] },
    });
    const pos = create({
      id: 'pos',
      priority: 20,
      triggers: { pluginActive: 'pos-control', resourceOnline: 'tailscale:pos-01' },
    });
    const selection = selectPromptFragments([pos, debug], {
      activeView: 'debug',
      visiblePanes: ['debug-events', 'debug-detail'],
      intents: ['inspect'],
    });
    expect(selection.selected.map(p => p.id)).toEqual(['debug']);
    expect(selection.rejected).toContainEqual({ id: 'pos', reason: 'trigger:pluginActive' });
  });

  test('enforces deterministic priority ordering and budget', () => {
    const a = create({ id: 'a', priority: 2, content: 'a '.repeat(160) });
    const b = create({ id: 'b', priority: 1, content: 'short prompt' });
    const selection = selectPromptFragments([a, b], {}, { budgetTokens: 15 });
    expect(selection.selected.map(p => p.id)).toEqual(['b']);
    expect(selection.rejected).toContainEqual({ id: 'a', reason: 'budget' });
  });

  test('rejects unsupported triggers explicitly', () => {
    const fragment = create({ id: 'future', triggers: { unknownFutureRule: true } });
    const selection = selectPromptFragments([fragment], {});
    expect(selection.selected).toEqual([]);
    expect(selection.rejected).toEqual([{ id: 'future', reason: 'trigger:unsupported:unknownFutureRule' }]);
  });
});

describe('buildPromptInjection', () => {
  test('composes selected fragments into target slots', () => {
    const system = create({ id: 'sys', name: 'System Rule', targetSlot: 'system', priority: 1, content: 'Use system rule.' });
    const context = create({ id: 'ctx', name: 'Debug Context', targetSlot: 'context', priority: 2, triggers: { view: 'debug' }, content: 'Use debug context.' });
    const slots = composeSlots([context, system]);
    expect(slots.system).toContain('### Prompt Fragment: System Rule');
    expect(slots.system).toContain('Use system rule.');
    expect(slots.context).toContain('Use debug context.');
  });

  test('selects from store, records usage, and writes an audit log', () => {
    create({ id: 'debug-context', targetSlot: 'context', triggers: { view: 'debug' }, content: 'Inspect debug panes.' });
    create({ id: 'pos-context', targetSlot: 'context', triggers: { pluginActive: 'pos' }, content: 'POS rules.' });
    const injection = buildPromptInjection({
      store,
      state: { activeView: 'debug', activePlugins: [], focusedPane: 'debug-events' },
      options: { sessionId: 's1', turnId: 't1', model: 'gpt-test' },
    });
    expect(injection.selection.selected.map(p => p.id)).toEqual(['debug-context']);
    expect(injection.slots.context).toContain('Inspect debug panes.');
    expect(injection.log?.turnId).toBe('t1');
    expect(store.get('debug-context')?.useCount).toBe(1);
    expect(store.listInjectionLogs(5).map(log => log.turnId)).toContain('t1');
  });

  test('can build without recording for dry-run explanations', () => {
    create({ id: 'dry-run', content: 'Dry run only.' });
    const injection = buildPromptInjection({
      store,
      state: {},
      options: { record: false, includeHeaders: false },
    });
    expect(injection.log).toBeUndefined();
    expect(injection.slots.context).toBe('Dry run only.');
    expect(store.listInjectionLogs()).toEqual([]);
    expect(store.get('dry-run')?.useCount).toBe(0);
  });

  test('renders selected slots for live prompt paths', () => {
    create({ id: 'sys-live', name: 'Live System', targetSlot: 'system', content: 'Prefer native panes.' });
    create({ id: 'ctx-live', name: 'Live Context', targetSlot: 'context', content: 'Window is compact.' });
    const injection = buildPromptInjection({ store, state: {}, options: { record: false } });

    const userText = renderPromptInjectionForUser(injection, { includeAuditLine: true });
    expect(userText).toContain('## Prompt Bank Audit');
    expect(userText).toContain('## Prompt Bank System Addendum');
    expect(userText).toContain('Prefer native panes.');
    expect(userText).toContain('## Prompt Bank Context');

    const systemText = renderPromptInjectionForSystemAddendum(injection);
    expect(systemText).toContain('## Prompt Bank Dynamic Context');
    expect(systemText).toContain('Window is compact.');
  });

  test('can render only selected slots for provider-native routing', () => {
    create({ id: 'sys-native', name: 'Native System', targetSlot: 'system', content: 'System-only.' });
    create({ id: 'ctx-native', name: 'Native Context', targetSlot: 'context', content: 'User context.' });
    const injection = buildPromptInjection({ store, state: {}, options: { record: false } });

    const userText = renderPromptInjectionForUser(injection, { slots: ['context'] });
    expect(userText).toContain('User context.');
    expect(userText).not.toContain('System-only.');
  });
});
