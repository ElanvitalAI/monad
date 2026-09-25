import { describe, expect, test } from 'bun:test';

import { composeDashboardKeyHandlers, dispatchDashboardKey } from '../src/dashboard/input/key-dispatcher.js';
import type { DashboardKeyHandler } from '../src/dashboard/input/key-types.js';

describe('dispatchDashboardKey', () => {
  test('runs handlers in order until one consumes', () => {
    const calls: string[] = [];
    const handlers: DashboardKeyHandler[] = [
      { name: 'first', handle: () => { calls.push('first'); return 'passthrough'; } },
      { name: 'second', handle: () => { calls.push('second'); return 'consumed'; } },
      { name: 'third', handle: () => { calls.push('third'); return 'consumed'; } },
    ];

    expect(dispatchDashboardKey({ name: 'x', ctrl: false, shift: false }, handlers)).toEqual({
      type: 'consumed',
      handler: 'second',
    });
    expect(calls).toEqual(['first', 'second']);
  });

  test('passes through when no handler consumes', () => {
    const handlers: DashboardKeyHandler[] = [
      { name: 'first', handle: () => 'passthrough' },
      { name: 'second', handle: () => 'passthrough' },
    ];

    expect(dispatchDashboardKey({ name: 'x', ctrl: false, shift: false }, handlers)).toEqual({
      type: 'passthrough',
    });
  });

  test('production handler composition gives question-view the key while it owns input', () => {
    const calls: string[] = [];
    const questionView: DashboardKeyHandler = {
      name: 'question-view',
      handle: () => { calls.push('question-view'); return 'consumed'; },
    };
    const inputCore: DashboardKeyHandler = {
      name: 'input-core',
      handle: () => { calls.push('input-core'); return 'consumed'; },
    };

    const handlers = composeDashboardKeyHandlers('question-view', questionView, [inputCore]);
    expect(dispatchDashboardKey({ name: 'x', ctrl: false, shift: false }, handlers, 'question-view')).toEqual({
      type: 'consumed',
      handler: 'question-view',
    });
    expect(calls).toEqual(['question-view']);
  });

  test('production handler composition excludes question-view when it does not own input', () => {
    const calls: string[] = [];
    const questionView: DashboardKeyHandler = {
      name: 'question-view',
      handle: () => { calls.push('question-view'); return 'consumed'; },
    };
    const inputCore: DashboardKeyHandler = {
      name: 'input-core',
      handle: () => { calls.push('input-core'); return 'consumed'; },
    };

    const handlers = composeDashboardKeyHandlers('chat-main', questionView, [inputCore]);
    expect(dispatchDashboardKey({ name: 'x', ctrl: false, shift: false }, handlers)).toEqual({
      type: 'consumed',
      handler: 'input-core',
    });
    expect(calls).toEqual(['input-core']);
  });

  test('targets question-view ahead of an earlier consuming handler', () => {
    const calls: string[] = [];
    const handlers: DashboardKeyHandler[] = [
      { name: 'input-core', handle: () => { calls.push('input-core'); return 'consumed'; } },
      { name: 'question-view', handle: () => { calls.push('question-view'); return 'consumed'; } },
    ];

    expect(dispatchDashboardKey({ name: 'x', ctrl: false, shift: false }, handlers, 'question-view')).toEqual({
      type: 'consumed',
      handler: 'question-view',
    });
    expect(calls).toEqual(['question-view']);
  });

  test('does not fall back when the targeted handler passes through', () => {
    const calls: string[] = [];
    const handlers: DashboardKeyHandler[] = [
      { name: 'input-core', handle: () => { calls.push('input-core'); return 'consumed'; } },
      { name: 'question-view', handle: () => { calls.push('question-view'); return 'passthrough'; } },
    ];

    expect(dispatchDashboardKey({ name: 'x', ctrl: false, shift: false }, handlers, 'question-view')).toEqual({
      type: 'passthrough',
    });
    expect(calls).toEqual(['question-view']);
  });

  test('passes through safely when the targeted handler is absent', () => {
    const calls: string[] = [];
    const handlers: DashboardKeyHandler[] = [
      { name: 'input-core', handle: () => { calls.push('input-core'); return 'consumed'; } },
    ];

    expect(dispatchDashboardKey({ name: 'x', ctrl: false, shift: false }, handlers, 'question-view')).toEqual({
      type: 'passthrough',
    });
    expect(calls).toEqual([]);
  });

  test('keeps registration-order dispatch with the same question-view handler when not targeted', () => {
    const calls: string[] = [];
    const handlers: DashboardKeyHandler[] = [
      { name: 'question-view', handle: () => { calls.push('question-view'); return 'passthrough'; } },
      { name: 'input-core', handle: () => { calls.push('input-core'); return 'consumed'; } },
    ];

    expect(dispatchDashboardKey({ name: 'x', ctrl: false, shift: false }, handlers)).toEqual({
      type: 'consumed',
      handler: 'input-core',
    });
    expect(calls).toEqual(['question-view', 'input-core']);
  });
});
