// ── PX-3 P2: HookDispatcher tests ──
//
// Covers register / unregister / list, priority ordering, timeout +
// error isolation, abort semantics (both from output + exception),
// output merge per event, ToolCall modifyInput cascade, and audit
// log NDJSON output.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HookDispatcher,
  listActiveHookEvents,
} from '../src/plugin-hooks/dispatcher';
import type { HookHandler } from '../src/plugin-hooks/types';

let auditRoot: string;
let dispatcher: HookDispatcher;
let warnings: string[];

beforeEach(() => {
  auditRoot = mkdtempSync(join(tmpdir(), 'hook-audit-'));
  warnings = [];
  dispatcher = new HookDispatcher({
    auditRoot,
    now: () => 1713400000000,  // fixed clock so audit is deterministic
    warn: (m) => warnings.push(m),
  });
});

afterEach(() => {
  rmSync(auditRoot, { recursive: true, force: true });
});

function turnHook(
  id: string, priority: number,
  impl: (input: any) => any | Promise<any>,
  over: Partial<HookHandler<'Turn'>> = {},
): HookHandler<'Turn'> {
  return {
    id, event: 'Turn', priority,
    invoke: impl,
    ...over,
  };
}

describe('register / unregister / list', () => {
  test('register returns dispose; unregister also works by id', () => {
    const dispose = dispatcher.register(turnHook('p:a', 50, () => ({})));
    expect(dispatcher.list('Turn').length).toBe(1);
    dispose();
    expect(dispatcher.list('Turn').length).toBe(0);

    dispatcher.register(turnHook('p:b', 50, () => ({})));
    expect(dispatcher.unregister('p:b')).toBe(true);
    expect(dispatcher.unregister('p:b')).toBe(false); // already gone
  });

  test('duplicate id rejected', () => {
    dispatcher.register(turnHook('p:a', 50, () => ({})));
    expect(() => dispatcher.register(turnHook('p:a', 50, () => ({})))).toThrow(/already registered/);
  });

  test('reserved priority emits advisory warning', () => {
    dispatcher.register(turnHook('p:a', 5, () => ({})));
    expect(warnings.some(w => w.includes('reserved priority 5'))).toBe(true);
  });

  test('invalid priority rejected', () => {
    expect(() => dispatcher.register(turnHook('p:a', -1, () => ({})))).toThrow(/invalid priority/);
    expect(() => dispatcher.register(turnHook('p:a', NaN, () => ({})))).toThrow(/invalid priority/);
  });

  test('listActiveHookEvents reflects registered events', () => {
    expect(listActiveHookEvents(dispatcher)).toEqual([]);
    dispatcher.register(turnHook('p:a', 50, () => ({})));
    expect(listActiveHookEvents(dispatcher)).toEqual(['Turn']);
  });

  test('clear() resets state', () => {
    dispatcher.register(turnHook('p:a', 50, () => ({})));
    dispatcher.clear();
    expect(dispatcher.list().length).toBe(0);
  });
});

describe('priority ordering', () => {
  test('ascending priority dispatched first', async () => {
    const order: string[] = [];
    dispatcher.register(turnHook('p:hi', 200, () => { order.push('hi'); return {}; }));
    dispatcher.register(turnHook('p:lo', 10, () => { order.push('lo'); return {}; }));
    dispatcher.register(turnHook('p:mid', 100, () => { order.push('mid'); return {}; }));

    await dispatcher.dispatch('Turn', {
      turnNumber: 1, messages: [], systemPrompt: '', tools: [],
    });
    expect(order).toEqual(['lo', 'mid', 'hi']);
  });

  test('same priority preserves registration order', async () => {
    const order: string[] = [];
    dispatcher.register(turnHook('p:a', 50, () => { order.push('a'); return {}; }));
    dispatcher.register(turnHook('p:b', 50, () => { order.push('b'); return {}; }));
    dispatcher.register(turnHook('p:c', 50, () => { order.push('c'); return {}; }));
    await dispatcher.dispatch('Turn', {
      turnNumber: 1, messages: [], systemPrompt: '', tools: [],
    });
    expect(order).toEqual(['a', 'b', 'c']);
  });
});

describe('output merge — Turn', () => {
  test('systemPromptInject concatenated with blank line', async () => {
    dispatcher.register(turnHook('p:a', 10, () => ({ systemPromptInject: 'ALPHA' })));
    dispatcher.register(turnHook('p:b', 20, () => ({ systemPromptInject: 'BETA' })));
    const r = await dispatcher.dispatch('Turn', {
      turnNumber: 1, messages: [], systemPrompt: '', tools: [],
    });
    expect(r.output.systemPromptInject).toBe('ALPHA\n\nBETA');
  });

  test('messagesPrepend concatenated', async () => {
    dispatcher.register(turnHook('p:a', 10, () => ({
      messagesPrepend: [{ role: 'user', content: 'A' }],
    })));
    dispatcher.register(turnHook('p:b', 20, () => ({
      messagesPrepend: [{ role: 'user', content: 'B' }],
    })));
    const r = await dispatcher.dispatch('Turn', {
      turnNumber: 1, messages: [], systemPrompt: '', tools: [],
    });
    expect(r.output.messagesPrepend?.map(m => m.content)).toEqual(['A', 'B']);
  });
});

describe('output merge — ToolCall', () => {
  test('deny first-wins', async () => {
    dispatcher.register({
      id: 'p:a', event: 'ToolCall', priority: 10,
      invoke: () => ({ deny: { reason: 'first' } }),
    });
    dispatcher.register({
      id: 'p:b', event: 'ToolCall', priority: 20,
      invoke: () => ({ deny: { reason: 'second' } }),
    });
    const r = await dispatcher.dispatch('ToolCall', {
      turnNumber: 1, toolName: 'Read', input: {},
    });
    expect(r.output.deny?.reason).toBe('first');
  });

  test('modifyInput cascades — next hook sees prior output', async () => {
    dispatcher.register({
      id: 'p:a', event: 'ToolCall', priority: 10,
      invoke: (input) => ({ modifyInput: { ...((input as any).input ?? {}), step1: true } }),
    });
    dispatcher.register({
      id: 'p:b', event: 'ToolCall', priority: 20,
      invoke: (input) => {
        const prev = (input as any).input;
        return { modifyInput: { ...prev, step2: true } };
      },
    });
    const r = await dispatcher.dispatch('ToolCall', {
      turnNumber: 1, toolName: 'Read', input: { path: '/x' },
    });
    expect(r.output.modifyInput).toEqual({ path: '/x', step1: true, step2: true });
  });
});

describe('matcher filter', () => {
  test('ToolCall matcher selects by toolName subject', async () => {
    const fired: string[] = [];
    dispatcher.register({
      id: 'p:read', event: 'ToolCall', priority: 10, matcher: 'Read',
      invoke: () => { fired.push('read'); return {}; },
    });
    dispatcher.register({
      id: 'p:edit', event: 'ToolCall', priority: 20, matcher: 'Edit',
      invoke: () => { fired.push('edit'); return {}; },
    });
    await dispatcher.dispatch('ToolCall', {
      turnNumber: 1, toolName: 'Read', input: {},
    }, { subject: 'Read' });
    expect(fired).toEqual(['read']);
  });

  test('matcher as array — any match', async () => {
    const fired: string[] = [];
    dispatcher.register({
      id: 'p:multi', event: 'ToolCall', priority: 10, matcher: ['Read', 'Edit'],
      invoke: () => { fired.push('multi'); return {}; },
    });
    await dispatcher.dispatch('ToolCall', {
      turnNumber: 1, toolName: 'Edit', input: {},
    }, { subject: 'Edit' });
    expect(fired).toEqual(['multi']);
  });

  test('handler with matcher skipped when no subject provided', async () => {
    const fired: string[] = [];
    dispatcher.register({
      id: 'p:scoped', event: 'ToolCall', priority: 10, matcher: 'Read',
      invoke: () => { fired.push('x'); return {}; },
    });
    await dispatcher.dispatch('ToolCall', {
      turnNumber: 1, toolName: 'Read', input: {},
    });
    expect(fired).toEqual([]);
  });
});

describe('timeout + error isolation', () => {
  test('timeout → step.status=timeout + chain continues', async () => {
    const hits: string[] = [];
    dispatcher.register({
      id: 'p:slow', event: 'Turn', priority: 10, timeoutMs: 20,
      invoke: () => new Promise(() => {}),  // never resolves
    });
    dispatcher.register(turnHook('p:fast', 20, () => { hits.push('fast'); return {}; }));
    const r = await dispatcher.dispatch('Turn', {
      turnNumber: 1, messages: [], systemPrompt: '', tools: [],
    });
    expect(r.steps[0]!.status).toBe('timeout');
    expect(hits).toEqual(['fast']);
  });

  test('throw → step.status=error + chain continues', async () => {
    const hits: string[] = [];
    dispatcher.register(turnHook('p:throw', 10, () => { throw new Error('boom'); }));
    dispatcher.register(turnHook('p:ok', 20, () => { hits.push('ok'); return {}; }));
    const r = await dispatcher.dispatch('Turn', {
      turnNumber: 1, messages: [], systemPrompt: '', tools: [],
    });
    expect(r.steps[0]!.status).toBe('error');
    expect(r.steps[0]!.message).toBe('boom');
    expect(hits).toEqual(['ok']);
  });
});

describe('abort semantics', () => {
  test('output.abort stops chain + surfaces reason', async () => {
    const fired: string[] = [];
    dispatcher.register(turnHook('p:a', 10, () => {
      fired.push('a');
      return { abort: { reason: 'budget exhausted' } };
    }));
    dispatcher.register(turnHook('p:b', 20, () => { fired.push('b'); return {}; }));
    const r = await dispatcher.dispatch('Turn', {
      turnNumber: 1, messages: [], systemPrompt: '', tools: [],
    });
    expect(fired).toEqual(['a']);
    expect(r.abort?.reason).toBe('budget exhausted');
    expect(r.abort?.from).toBe('p:a');
  });
});

describe('audit log', () => {
  test('writes NDJSON line per handler invocation', async () => {
    dispatcher.register(turnHook('p:a', 10, () => ({ systemPromptInject: 'x' })));
    dispatcher.register(turnHook('p:b', 20, () => { throw new Error('bad'); }));
    await dispatcher.dispatch('Turn', {
      turnNumber: 1, messages: [], systemPrompt: '', tools: [],
    });
    // Fixed clock = 2024-04-17 (for ts=1713400000000).
    const files = readdirSync(auditRoot).filter(f => f.endsWith('.ndjson'));
    expect(files.length).toBe(1);
    const raw = readFileSync(join(auditRoot, files[0]!), 'utf-8');
    const lines = raw.trim().split('\n').map(l => JSON.parse(l));
    expect(lines.length).toBe(2);
    expect(lines[0]!.event).toBe('Turn');
    expect(lines[0]!.status).toBe('ok');
    expect(lines[0]!.outputKeys).toEqual(['systemPromptInject']);
    expect(lines[1]!.status).toBe('error');
    expect(lines[1]!.message).toBe('bad');
  });

  test('auditRoot=null disables logging', async () => {
    const d = new HookDispatcher({ auditRoot: null });
    d.register(turnHook('p:a', 50, () => ({})));
    await d.dispatch('Turn', {
      turnNumber: 1, messages: [], systemPrompt: '', tools: [],
    });
    expect(existsSync(auditRoot)).toBe(true);
    expect(readdirSync(auditRoot).filter(f => f.endsWith('.ndjson')).length).toBe(0);
  });
});
