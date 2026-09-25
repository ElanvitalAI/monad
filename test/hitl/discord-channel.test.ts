// AXON P4 — Discord HITL channel tests.
//
// A minimal fake bot records post + click intents so we can assert
// the wire layout and resolve pending answers without pulling in
// a real Discord SDK.

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  createDiscordHitlPostDeps,
  type DiscordBot,
  type DiscordButtonQuery,
} from '../../src/hitl/discord-channel.js';

interface PostedMessage {
  channelId: string;
  text: string;
  buttons: ReadonlyArray<{ label: string; customId: string; style?: string }>;
  messageId: string;
}

function createFakeBot() {
  const posts: PostedMessage[] = [];
  const edits: Array<{ channelId: string; messageId: string; text: string }> = [];
  let handler: ((q: DiscordButtonQuery) => void | Promise<void>) | null = null;
  let nextId = 100;

  const bot: DiscordBot = {
    async sendButtons(channelId, text, buttons) {
      const messageId = String(nextId++);
      posts.push({ channelId, text, buttons: [...buttons], messageId });
      return { messageId };
    },
    onButtonClick(h) { handler = h; },
    async editMessage(channelId, messageId, text) {
      edits.push({ channelId, messageId, text });
    },
  };

  async function tap(customId: string, channelId: string, acks: string[] = []) {
    if (!handler) throw new Error('no handler subscribed');
    const q: DiscordButtonQuery = {
      customId,
      channelId,
      async ack(text) { if (text !== undefined) acks.push(text); },
    };
    await handler(q);
    return acks;
  }

  return { bot, posts, edits, tap };
}

let env = createFakeBot();
beforeEach(() => {
  env = createFakeBot();
});

describe('createDiscordHitlPostDeps', () => {
  it('posts a prompt with Yes/No buttons using the correct customId prefix', async () => {
    const deps = createDiscordHitlPostDeps({ bot: env.bot, channelId: 'C1' });
    await deps.post({ prompt: 'Run tests?', requestId: 'hitl-abc' });
    expect(env.posts).toHaveLength(1);
    const m = env.posts[0]!;
    expect(m.channelId).toBe('C1');
    expect(m.text).toBe('Run tests?');
    expect(m.buttons).toHaveLength(2);
    expect(m.buttons[0]!.customId).toBe('monad-hitl-disc:hitl-abc:yes');
    expect(m.buttons[1]!.customId).toBe('monad-hitl-disc:hitl-abc:no');
  });

  it('resolves the answer to true when the Yes button is clicked', async () => {
    const deps = createDiscordHitlPostDeps({ bot: env.bot, channelId: 'C1' });
    const handle = await deps.post({ prompt: 'go?', requestId: 'hitl-yes' });
    await env.tap('monad-hitl-disc:hitl-yes:yes', 'C1');
    expect(await handle.answer).toBe(true);
  });

  it('resolves the answer to false when the No button is clicked', async () => {
    const deps = createDiscordHitlPostDeps({ bot: env.bot, channelId: 'C1' });
    const handle = await deps.post({ prompt: 'go?', requestId: 'hitl-no' });
    await env.tap('monad-hitl-disc:hitl-no:no', 'C1');
    expect(await handle.answer).toBe(false);
  });

  it('ignores clicks from other channels', async () => {
    const deps = createDiscordHitlPostDeps({ bot: env.bot, channelId: 'C1' });
    const handle = await deps.post({ prompt: 'go?', requestId: 'hitl-xcc' });
    // Tap from a different channel — should not resolve.
    await env.tap('monad-hitl-disc:hitl-xcc:yes', 'CDIFFERENT');
    // Now the right channel clicks:
    await env.tap('monad-hitl-disc:hitl-xcc:no', 'C1');
    expect(await handle.answer).toBe(false);
  });

  it('ignores clicks that do not use the monad-hitl prefix', async () => {
    const deps = createDiscordHitlPostDeps({ bot: env.bot, channelId: 'C1' });
    const handle = await deps.post({ prompt: 'go?', requestId: 'hitl-pfx' });
    const acks: string[] = [];
    await env.tap('some-other-plugin:123:yes', 'C1', acks);
    // Still pending — resolve via matching prefix:
    await env.tap('monad-hitl-disc:hitl-pfx:yes', 'C1');
    expect(await handle.answer).toBe(true);
    expect(acks).toEqual([]);   // no ack for the unrelated click
  });

  it('acks expired requests with "request expired"', async () => {
    const deps = createDiscordHitlPostDeps({ bot: env.bot, channelId: 'C1' });
    const acks: string[] = [];
    await env.tap('monad-hitl-disc:never-posted:yes', 'C1', acks);
    expect(acks).toEqual(['request expired']);
  });

  it('edits the message with the outcome when editOnResolve is on (default)', async () => {
    const deps = createDiscordHitlPostDeps({ bot: env.bot, channelId: 'C1' });
    await deps.post({ prompt: 'go?', requestId: 'hitl-edit' });
    await env.tap('monad-hitl-disc:hitl-edit:yes', 'C1');
    expect(env.edits).toHaveLength(1);
    expect(env.edits[0]!.text).toBe('✓ confirmed');
  });

  it('skips edit when editOnResolve is false', async () => {
    const deps = createDiscordHitlPostDeps({
      bot: env.bot, channelId: 'C1', editOnResolve: false,
    });
    await deps.post({ prompt: 'go?', requestId: 'hitl-noedit' });
    await env.tap('monad-hitl-disc:hitl-noedit:no', 'C1');
    expect(env.edits).toEqual([]);
  });

  it('cancel() resolves null without firing the click handler', async () => {
    const deps = createDiscordHitlPostDeps({ bot: env.bot, channelId: 'C1' });
    const handle = await deps.post({ prompt: 'go?', requestId: 'hitl-cancel' });
    await handle.cancel();
    expect(await handle.answer).toBeNull();
  });

  it('second tap on the same request is ignored (request already resolved)', async () => {
    const deps = createDiscordHitlPostDeps({ bot: env.bot, channelId: 'C1' });
    const handle = await deps.post({ prompt: 'go?', requestId: 'hitl-dup' });
    await env.tap('monad-hitl-disc:hitl-dup:yes', 'C1');
    const acks: string[] = [];
    await env.tap('monad-hitl-disc:hitl-dup:no', 'C1', acks);
    // First answer wins — answer is still true, second tap gets expired.
    expect(await handle.answer).toBe(true);
    expect(acks).toEqual(['request expired']);
  });

  it('auto-mints a requestId when the caller does not supply one', async () => {
    const deps = createDiscordHitlPostDeps({ bot: env.bot, channelId: 'C1' });
    await deps.post({ prompt: 'go?' });
    const customId = env.posts[0]!.buttons[0]!.customId;
    expect(customId.startsWith('monad-hitl-disc:hitl-')).toBe(true);
  });
});
