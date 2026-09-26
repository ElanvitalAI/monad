// Unit tests for the tui-client `elanous/ui/*` envelope dispatcher
// (UI-Core arc Phase U3).

import { describe, expect, test } from 'bun:test';

import {
  formatElanousUiEnvelope,
  type ElanousUiShowModalPayload,
  type ElanousUiShowToastPayload,
  type ElanousUiUpdateStatusPillPayload,
} from '../src/acp/elanous-extensions.js';
import {
  dispatchThoughtChunk,
  extractAgentThoughtText,
  type ElanousUiHandler,
} from '../src/tui-client/elanous-ui-handler.js';

describe('dispatchThoughtChunk', () => {
  test('showModal envelope routes to onShowModal', async () => {
    const seen: ElanousUiShowModalPayload[] = [];
    const handler: ElanousUiHandler = { onShowModal: (p) => { seen.push(p); } };
    const payload: ElanousUiShowModalPayload = {
      id: 'm1',
      kind: 'info',
      title: 't',
      actions: [],
    };
    const text = formatElanousUiEnvelope({ method: 'showModal', payload });
    const out = await dispatchThoughtChunk(text, handler);
    expect(out).toEqual({ kind: 'ui', method: 'showModal' });
    expect(seen).toEqual([payload]);
  });

  test('showToast envelope routes to onShowToast', async () => {
    const seen: ElanousUiShowToastPayload[] = [];
    const handler: ElanousUiHandler = { onShowToast: (p) => { seen.push(p); } };
    const payload: ElanousUiShowToastPayload = { id: 't1', tone: 'info', text: 'saved' };
    const text = formatElanousUiEnvelope({ method: 'showToast', payload });
    const out = await dispatchThoughtChunk(text, handler);
    expect(out).toEqual({ kind: 'ui', method: 'showToast' });
    expect(seen).toEqual([payload]);
  });

  test('updateStatusPill envelope routes to onUpdateStatusPill', async () => {
    const seen: ElanousUiUpdateStatusPillPayload[] = [];
    const handler: ElanousUiHandler = { onUpdateStatusPill: (p) => { seen.push(p); } };
    const payload: ElanousUiUpdateStatusPillPayload = { id: 'bco', text: 'ready' };
    const text = formatElanousUiEnvelope({ method: 'updateStatusPill', payload });
    const out = await dispatchThoughtChunk(text, handler);
    expect(out).toEqual({ kind: 'ui', method: 'updateStatusPill' });
    expect(seen).toEqual([payload]);
  });

  test('missing handler method still returns ui outcome (capability drop)', async () => {
    const handler: ElanousUiHandler = {}; // no methods implemented
    const text = formatElanousUiEnvelope({
      method: 'showModal',
      payload: { id: 'x', kind: 'info', title: 't', actions: [] },
    });
    const out = await dispatchThoughtChunk(text, handler);
    expect(out.kind).toBe('ui');
  });

  test('plain text returns passthrough', async () => {
    const handler: ElanousUiHandler = {
      onShowModal: () => { throw new Error('should not fire'); },
    };
    const out = await dispatchThoughtChunk('just a thought from the agent', handler);
    expect(out).toEqual({ kind: 'passthrough', text: 'just a thought from the agent' });
  });

  test('non-elanous envelope (notify relay) returns passthrough', async () => {
    const handler: ElanousUiHandler = {
      onShowModal: () => { throw new Error('should not fire'); },
    };
    const out = await dispatchThoughtChunk('[notify:block] foo', handler);
    expect(out.kind).toBe('passthrough');
  });

  test('handler error propagates (caller responsible for catch)', async () => {
    const handler: ElanousUiHandler = {
      onShowToast: async () => { throw new Error('boom'); },
    };
    const text = formatElanousUiEnvelope({
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
