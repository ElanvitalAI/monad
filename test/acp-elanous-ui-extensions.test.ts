// Unit tests for the `elanous/ui/*` extension envelope format +
// capability parsing (UI-Core arc Phase U2).
//
// The envelope is a text wrapper on top of sessionUpdate payload; this
// suite validates format/parse round-trips + capability declaration
// parsing without spinning up an ACP connection. Server-side dispatch
// tests live alongside in `acp-server-ui-dispatch.test.ts`.

import { describe, expect, test } from 'bun:test';

import {
  emitElanousUiCapabilitiesMeta,
  formatElanousUiEnvelope,
  formatElanousUiResponse,
  ELANOUS_UI_DISABLED,
  ELANOUS_UI_FULL,
  parseElanousUiCapabilities,
  parseElanousUiEnvelope,
  parseElanousUiResponse,
  type ElanousUiShowModalPayload,
  type ElanousUiShowToastPayload,
  type ElanousUiUpdateStatusPillPayload,
} from '../src/acp/elanous-extensions.js';

describe('formatElanousUiEnvelope', () => {
  test('showModal envelope encodes head + json body + end marker', () => {
    const payload: ElanousUiShowModalPayload = {
      id: 'm1',
      kind: 'info',
      title: 'KGS ready',
      body: '10 pages crystallized',
      actions: [{ id: 'view', label: '열기', tone: 'primary' }],
    };
    const text = formatElanousUiEnvelope({ method: 'showModal', payload });
    const lines = text.split('\n');
    expect(lines[0]).toBe('[elanous/ui/showModal] m1');
    expect(lines[lines.length - 1]).toBe('<<elanous-ui-end m1>>');
    // Body in-between must be valid JSON equal to payload.
    const bodyJson = lines.slice(1, -1).join('\n');
    expect(JSON.parse(bodyJson)).toEqual(payload);
  });

  test('showToast envelope works', () => {
    const payload: ElanousUiShowToastPayload = {
      id: 't1',
      tone: 'success',
      text: 'saved',
    };
    const text = formatElanousUiEnvelope({ method: 'showToast', payload });
    expect(text).toContain('[elanous/ui/showToast] t1');
    expect(text).toContain('<<elanous-ui-end t1>>');
  });

  test('updateStatusPill envelope works', () => {
    const payload: ElanousUiUpdateStatusPillPayload = {
      id: 'bco-daemon',
      text: '🌐 ready',
      tone: 'success',
      tooltip: 'Chrome CDP connected',
    };
    const text = formatElanousUiEnvelope({ method: 'updateStatusPill', payload });
    expect(text).toContain('[elanous/ui/updateStatusPill] bco-daemon');
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
    const text = formatElanousUiEnvelope({ method: 'usage', payload });
    expect(text.startsWith('[elanous/ui/usage] turn:1700000')).toBe(true);
    const decoded = parseElanousUiEnvelope(text);
    expect(decoded?.method).toBe('usage');
    expect(decoded?.payload).toEqual(payload);
  });
});

describe('parseElanousUiEnvelope', () => {
  test('round-trips showModal', () => {
    const payload: ElanousUiShowModalPayload = {
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
    const encoded = formatElanousUiEnvelope({ method: 'showModal', payload });
    const decoded = parseElanousUiEnvelope(encoded);
    expect(decoded?.method).toBe('showModal');
    expect(decoded?.payload).toEqual(payload as unknown as Record<string, unknown>);
  });

  test('returns null on non-envelope text', () => {
    expect(parseElanousUiEnvelope('hello world')).toBeNull();
    expect(parseElanousUiEnvelope('[notify:foo] bar')).toBeNull();
    expect(parseElanousUiEnvelope('')).toBeNull();
  });

  test('returns null on unknown method', () => {
    expect(parseElanousUiEnvelope('[elanous/ui/unknown] x\n{}')).toBeNull();
  });

  test('returns null on malformed json body', () => {
    const bad = '[elanous/ui/showToast] x\n{not valid json\n<<elanous-ui-end x>>';
    expect(parseElanousUiEnvelope(bad)).toBeNull();
  });
});

describe('parseElanousUiResponse / formatElanousUiResponse', () => {
  test('round-trips', () => {
    const encoded = formatElanousUiResponse({ id: 'm1', actionId: 'view' });
    expect(encoded).toBe('[elanous/ui/response] m1 view');
    const decoded = parseElanousUiResponse(encoded);
    expect(decoded).toEqual({ id: 'm1', actionId: 'view' });
  });

  test('ignores non-response text', () => {
    expect(parseElanousUiResponse('normal user prompt')).toBeNull();
    expect(parseElanousUiResponse('[elanous/ui/showModal] x\nbody')).toBeNull();
  });
});

describe('ElanousUiClientCapabilities parse + emit', () => {
  test('parses meta blob from extension-aware client', () => {
    const meta = { elanous: { ui: { showModal: true, showToast: true, updateStatusPill: false, usage: true } } };
    expect(parseElanousUiCapabilities(meta)).toEqual({
      showModal: true,
      showToast: true,
      updateStatusPill: false,
      usage: true,
    });
  });

  test('returns all-false on missing / malformed meta', () => {
    expect(parseElanousUiCapabilities(undefined)).toEqual(ELANOUS_UI_DISABLED);
    expect(parseElanousUiCapabilities(null)).toEqual(ELANOUS_UI_DISABLED);
    expect(parseElanousUiCapabilities({})).toEqual(ELANOUS_UI_DISABLED);
    expect(parseElanousUiCapabilities({ elanous: 42 })).toEqual(ELANOUS_UI_DISABLED);
  });

  test('emit → parse round-trips full caps', () => {
    const meta = emitElanousUiCapabilitiesMeta(ELANOUS_UI_FULL);
    expect(parseElanousUiCapabilities(meta)).toEqual(ELANOUS_UI_FULL);
  });
});
