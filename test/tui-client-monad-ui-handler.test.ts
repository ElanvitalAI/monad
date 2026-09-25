// Unit tests for the tui-client `monad/ui/*` envelope dispatcher
// (UI-Core arc Phase U3).

import { describe, expect, test } from 'bun:test';

import {
  formatMonadUiEnvelope,
  type MonadUiShowModalPayload,
  type MonadUiShowToastPayload,
  type MonadUiUpdateStatusPillPayload,
} from '../src/acp/monad-extensions.js';
import {
  dispatchThoughtChunk,
  extractAgentThoughtText,
  type MonadUiHandler,
} from '../src/tui-client/monad-ui-handler.js';

describe('dispatchThoughtChunk', () => {
  test('showModal envelope routes to onShowModal', async () => {
    const seen: MonadUiShowModalPayload[] = [];
    const handler: MonadUiHandler = { onShowModal: (p) => { seen.push(p); } };
    const payload: MonadUiShowModalPayload = {
      id: 'm1',
      kind: 'info',
      title: 't',
      actions: [],
    };
    const text = formatMonadUiEnvelope({ method: 'showModal', payload });
    const out = await dispatchThoughtChunk(text, handler);
    expect(out).toEqual({ kind: 'ui', method: 'showModal' });
    expect(seen).toEqual([payload]);
  });

  test('showToast envelope routes to onShowToast', async () => {
    const seen: MonadUiShowToastPayload[] = [];
    const handler: MonadUiHandler = { onShowToast: (p) => { seen.push(p); } };
    const payload: MonadUiShowToastPayload = { id: 't1', tone: 'info', text: 'saved' };
    const text = formatMonadUiEnvelope({ method: 'showToast', payload });
    const out = await dispatchThoughtChunk(text, handler);
    expect(out).toEqual({ kind: 'ui', method: 'showToast' });
    expect(seen).toEqual([payload]);
  });

  test('updateStatusPill envelope routes to onUpdateStatusPill', async () => {
    const seen: MonadUiUpdateStatusPillPayload[] = [];
    const handler: MonadUiHandler = { onUpdateStatusPill: (p) => { seen.push(p); } };
    const payload: MonadUiUpdateStatusPillPayload = { id: 'bco', text: 'ready' };
    const text = formatMonadUiEnvelope({ method: 'updateStatusPill', payload });
    const out = await dispatchThoughtChunk(text, handler);
    expect(out).toEqual({ kind: 'ui', method: 'updateStatusPill' });
    expect(seen).toEqual([payload]);
  });

  test('missing handler method still returns ui outcome (capability drop)', async () => {
    const handler: MonadUiHandler = {}; // no methods implemented
    const text = formatMonadUiEnvelope({
      method: 'showModal',
      payload: { id: 'x', kind: 'info', title: 't', actions: [] },
    });
    const out = await dispatchThoughtChunk(text, handler);
    expect(out.kind).toBe('ui');
  });

  test('plain text returns passthrough', async () => {
    const handler: MonadUiHandler = {
      onShowModal: () => { throw new Error('should not fire'); },
    };
    const out = await dispatchThoughtChunk('just a thought from the agent', handler);
    expect(out).toEqual({ kind: 'passthrough', text: 'just a thought from the agent' });
  });

  test('non-monad envelope (notify relay) returns passthrough', async () => {
    const handler: MonadUiHandler = {
      onShowModal: () => { throw new Error('should not fire'); },
    };
    const out = await dispatchThoughtChunk('[notify:block] foo', handler);
    expect(out.kind).toBe('passthrough');
  });

  test('handler error propagates (caller responsible for catch)', async () => {
    const handler: MonadUiHandler = {
      onShowToast: async () => { throw new Error('boom'); },
    };
    const text = formatMonadUiEnvelope({
      method: 'showToast',
      payload: { id: 't1', tone: 'info', text: 'x' },
    });
    await expect(dispatchThoughtChunk(text, handler)).rejects.toThrow('boom');
  });
});

describe('extractAgentThoughtText', () => {
  test('extracts text from valid agent_thought_chunk', () => {
    const update = {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'hello' },
    };
    expect(extractAgentThoughtText(update)).toBe('hello');
  });

  test('returns null for other sessionUpdate kinds', () => {
    expect(extractAgentThoughtText({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'x' },
    })).toBeNull();
  });

  test('returns null for non-text content', () => {
    expect(extractAgentThoughtText({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'image', data: 'base64' },
    })).toBeNull();
  });

  test('returns null for malformed input', () => {
    expect(extractAgentThoughtText(null)).toBeNull();
    expect(extractAgentThoughtText(undefined)).toBeNull();
    expect(extractAgentThoughtText('string')).toBeNull();
    expect(extractAgentThoughtText({})).toBeNull();
  });
});
