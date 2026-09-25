import { describe, expect, test } from 'bun:test';
import {
  applyTurnTypeaheadKey,
  type TurnTypeaheadState,
} from '../../chat/turn-typeahead.js';
import { SlashCommandRegistry } from '../slash-runtime/registry.js';
import { dispatchStreamingTurnTypeaheadSubmission } from './streaming-turn-typeahead.js';

const enter = { name: 'enter' };
const typedImmediate = (): TurnTypeaheadState => applyTurnTypeaheadKey(
  { buffer: '/observe child', queuedSubmissions: ['first sentence'] },
  enter,
  text => text === '/observe child',
).state;

function registryDispatch<Ctx>(registry: SlashCommandRegistry<Ctx>, ctx: Ctx) {
  return async (_text: string): Promise<boolean> => {
    const outcome = await registry.dispatch('observe', ['child'], ctx);
    return outcome.kind !== 'unregistered';
  };
}

describe('streaming turn typeahead slash dispatch rollback', () => {
  test('handler throw restores the immediate slash to FIFO once and preserves later input', async () => {
    const registry = new SlashCommandRegistry<object>();
    registry.register('observe', () => { throw new Error('handler failure'); });

    const rolledBack = await dispatchStreamingTurnTypeaheadSubmission(
      typedImmediate(),
      '/observe child',
      registryDispatch(registry, {}),
    );
    const next = applyTurnTypeaheadKey(rolledBack, { name: 'x' });

    expect(rolledBack).toEqual({ buffer: '', queuedSubmissions: ['first sentence', '/observe child'] });
    expect(next.state).toEqual({ buffer: 'x', queuedSubmissions: ['first sentence', '/observe child'] });
  });

  test('context throw from an async handler restores the immediate slash to FIFO', async () => {
    const registry = new SlashCommandRegistry<{ child: { snapshot: () => Promise<void> } }>();
    registry.register('observe', async (_args, ctx) => { await ctx.child.snapshot(); });
    const ctx = {
      child: {
        snapshot: async () => { throw new Error('context failure'); },
      },
    };

    const rolledBack = await dispatchStreamingTurnTypeaheadSubmission(
      typedImmediate(),
      '/observe child',
      registryDispatch(registry, ctx),
    );
    const next = applyTurnTypeaheadKey(rolledBack, { name: 'x' });

    expect(rolledBack).toEqual({ buffer: '', queuedSubmissions: ['first sentence', '/observe child'] });
    expect(next.state).toEqual({ buffer: 'x', queuedSubmissions: ['first sentence', '/observe child'] });
  });

  test('an unregistered command falls back to FIFO instead of being consumed', async () => {
    const registry = new SlashCommandRegistry<object>();

    await expect(dispatchStreamingTurnTypeaheadSubmission(
      typedImmediate(),
      '/observe child',
      registryDispatch(registry, {}),
    )).resolves.toEqual({ buffer: '', queuedSubmissions: ['first sentence', '/observe child'] });
  });

  test('a handled command remains consumed without FIFO rollback', async () => {
    const registry = new SlashCommandRegistry<object>();
    registry.register('observe', () => {});

    await expect(dispatchStreamingTurnTypeaheadSubmission(
      typedImmediate(),
      '/observe child',
      registryDispatch(registry, {}),
    )).resolves.toEqual({ buffer: '', queuedSubmissions: ['first sentence'] });
  });
});
