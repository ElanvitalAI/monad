// Unit tests for the `monad/ui/*` extension envelope format +
// capability parsing (UI-Core arc Phase U2).
//
// The envelope is a text wrapper on top of sessionUpdate payload; this
// suite validates format/parse round-trips + capability declaration
// parsing without spinning up an ACP connection. Server-side dispatch
// tests live alongside in `acp-server-ui-dispatch.test.ts`.

import { describe, expect, test } from 'bun:test';

import {
  emitMonadUiCapabilitiesMeta,
  formatMonadUiEnvelope,
  formatMonadUiResponse,
  MONAD_UI_DISABLED,
  MONAD_UI_FULL,
  parseMonadUiCapabilities,
  parseMonadUiEnvelope,
  parseMonadUiResponse,
  type MonadUiShowModalPayload,
  type MonadUiShowToastPayload,
  type MonadUiUpdateStatusPillPayload,
} from '../src/acp/monad-extensions.js';

describe('formatMonadUiEnvelope', () => {
  test('showModal envelope encodes head + json body + end marker', () => {
    const payload: MonadUiShowModalPayload = {
      id: 'm1',
      kind: 'info',
      title: 'KGS ready',
      body: '10 pages crystallized',
      actions: [{ id: 'view', label: '열기', tone: 'primary' }],
    };
    const text = formatMonadUiEnvelope({ method: 'showModal', payload });
    const lines = text.split('\n');
    expect(lines[0]).toBe('[monad/ui/showModal] m1');
    expect(lines[lines.length - 1]).toBe('<<monad-ui-end m1>>');
    // Body in-between must be valid JSON equal to payload.
    const bodyJson = lines.slice(1, -1).join('\n');
    expect(JSON.parse(bodyJson)).toEqual(payload);
  });

  test('showToast envelope works', () => {
    const payload: MonadUiShowToastPayload = {
      id: 't1',
      tone: 'success',
      text: 'saved',
    };
    const text = formatMonadUiEnvelope({ method: 'showToast', payload });
    expect(text).toContain('[monad/ui/showToast] t1');
    expect(text).toContain('<<monad-ui-end t1>>');
  });

  test('updateStatusPill envelope works', () => {
    const payload: MonadUiUpdateStatusPillPayload = {
      id: 'bco-daemon',
      text: '🌐 ready',
      tone: 'success',
      tooltip: 'Chrome CDP connected',
    };
    const text = formatMonadUiEnvelope({ method: 'updateStatusPill', payload });
    expect(text).toContain('[monad/ui/updateStatusPill] bco-daemon');
  });

  test('P2-bridge-ext — usage envelope round-trips', () => {
    const payload = {
      id: 'turn:1700000',
      provider: 'anthropic' as const,
      inputTokens: 12,
      outputTokens: 5,
      cacheReadInputTokens: 80,
      cacheCreationInputTokens: 0,
    };
    const text = formatMonadUiEnvelope({ method: 'usage', payload });
    expect(text.startsWith('[monad/ui/usage] turn:1700000')).toBe(true);
    const decoded = parseMonadUiEnvelope(text);
    expect(decoded?.method).toBe('usage');
    expect(decoded?.payload).toEqual(payload);
  });
});

describe('parseMonadUiEnvelope', () => {
  test('round-trips showModal', () => {
    const payload: MonadUiShowModalPayload = {
      id: 'm2',
      kind: 'danger',
      title: 'Destructive',
      body: 'This deletes 42 files',
      actions: [
        { id: 'ok', label: 'Delete', tone: 'danger' },
        { id: 'cancel', label: 'Cancel' },
      ],
      timeoutMs: 5000,
    };
    const encoded = formatMonadUiEnvelope({ method: 'showModal', payload });
    const decoded = parseMonadUiEnvelope(encoded);
    expect(decoded?.method).toBe('showModal');
    expect(decoded?.payload).toEqual(payload as unknown as Record<string, unknown>);
  });

  test('returns null on non-envelope text', () => {
    expect(parseMonadUiEnvelope('hello world')).toBeNull();
    expect(parseMonadUiEnvelope('[notify:foo] bar')).toBeNull();
    expect(parseMonadUiEnvelope('')).toBeNull();
  });

  test('returns null on unknown method', () => {
    expect(parseMonadUiEnvelope('[monad/ui/unknown] x\n{}')).toBeNull();
  });

  test('returns null on malformed json body', () => {
    const bad = '[monad/ui/showToast] x\n{not valid json\n<<monad-ui-end x>>';
    expect(parseMonadUiEnvelope(bad)).toBeNull();
  });
});

describe('parseMonadUiResponse / formatMonadUiResponse', () => {
  test('round-trips', () => {
    const encoded = formatMonadUiResponse({ id: 'm1', actionId: 'view' });
    expect(encoded).toBe('[monad/ui/response] m1 view');
    const decoded = parseMonadUiResponse(encoded);
    expect(decoded).toEqual({ id: 'm1', actionId: 'view' });
  });

  test('ignores non-response text', () => {
    expect(parseMonadUiResponse('normal user prompt')).toBeNull();
    expect(parseMonadUiResponse('[monad/ui/showModal] x\nbody')).toBeNull();
  });
});

describe('MonadUiClientCapabilities parse + emit', () => {
  test('parses meta blob from extension-aware client', () => {
    const meta = { monad: { ui: { showModal: true, showToast: true, updateStatusPill: false, usage: true } } };
    expect(parseMonadUiCapabilities(meta)).toEqual({
      showModal: true,
      showToast: true,
      updateStatusPill: false,
      usage: true,
    });
  });

  test('returns all-false on missing / malformed meta', () => {
    expect(parseMonadUiCapabilities(undefined)).toEqual(MONAD_UI_DISABLED);
    expect(parseMonadUiCapabilities(null)).toEqual(MONAD_UI_DISABLED);
    expect(parseMonadUiCapabilities({})).toEqual(MONAD_UI_DISABLED);
    expect(parseMonadUiCapabilities({ monad: 42 })).toEqual(MONAD_UI_DISABLED);
  });

  test('emit → parse round-trips full caps', () => {
    const meta = emitMonadUiCapabilitiesMeta(MONAD_UI_FULL);
    expect(parseMonadUiCapabilities(meta)).toEqual(MONAD_UI_FULL);
  });
});
