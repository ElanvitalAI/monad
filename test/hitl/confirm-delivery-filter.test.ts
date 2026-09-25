// AXON P4 — verify the delivery filter added to requestConfirmation
// prunes channels by name before the race begins.

import { describe, it, expect } from 'bun:test';
import { requestConfirmation, type ConfirmChannel } from '../../src/hitl/confirm.js';
import { channelMatchesDelivery } from '../../src/hitl/types.js';

function sawFirst(name: string, answer: boolean | null) {
  const seen: string[] = [];
  const ch: ConfirmChannel = {
    name,
    async request() { seen.push(name); return answer; },
    cancel() { /* noop */ },
  };
  return { ch, seen };
}

describe('requestConfirmation — delivery filter', () => {
  it("'all' (default) consults every channel concurrently", async () => {
    const t = sawFirst('telegram', true);
    const d = sawFirst('discord', true);
    const result = await requestConfirmation({
      prompt: 'go?',
      channels: [t.ch, d.ch],
    });
    // Both channels raced; one of them won (first-answer-wins).
    expect(t.seen.length + d.seen.length).toBe(2);
    expect(result.answer).toBe(true);
    expect(['telegram', 'discord']).toContain(result.channel);
  });

  it("'telegram' picks only the telegram channel", async () => {
    const t = sawFirst('telegram', true);
    const d = sawFirst('discord', false);
    const result = await requestConfirmation({
      prompt: 'go?',
      channels: [t.ch, d.ch],
      delivery: 'telegram',
    });
    expect(t.seen).toEqual(['telegram']);
    expect(d.seen).toEqual([]);
    expect(result.answer).toBe(true);
  });

  it("'modal' maps to the terminal channel", async () => {
    const term = sawFirst('terminal', true);
    const tg = sawFirst('telegram', false);
    const result = await requestConfirmation({
      prompt: 'go?',
      channels: [term.ch, tg.ch],
      delivery: 'modal',
    });
    expect(term.seen).toEqual(['terminal']);
    expect(tg.seen).toEqual([]);
    expect(result.answer).toBe(true);
  });

  it('returns all-failed when the delivery filter leaves no channel', async () => {
    const t = sawFirst('telegram', true);
    const result = await requestConfirmation({
      prompt: 'go?',
      channels: [t.ch],
      delivery: 'discord',
      onTimeout: () => true,   // let us see the timeout fallback
    });
    expect(result.channel).toBe('all-failed');
    expect(result.answer).toBe(true);
    expect(t.seen).toEqual([]);
  });

  it('channelMatchesDelivery helper matches the filter semantics', () => {
    expect(channelMatchesDelivery('terminal', 'modal')).toBe(true);
    expect(channelMatchesDelivery('terminal', 'terminal')).toBe(true);
    expect(channelMatchesDelivery('telegram', 'telegram')).toBe(true);
    expect(channelMatchesDelivery('discord', 'telegram')).toBe(false);
    expect(channelMatchesDelivery('discord', 'all')).toBe(true);
  });
});
