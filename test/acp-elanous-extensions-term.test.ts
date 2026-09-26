// WT-S-1 — ElanousTermEnvelope round-trip + sentinel disjoint-ness from
// the existing ElanousUiEnvelope. The two share `agent_thought_chunk`
// transport so any sentinel collision would silently mis-route.

import { describe, expect, test } from 'bun:test';
import {
  formatElanousTermEnvelope,
  parseElanousTermEnvelope,
  formatElanousUiEnvelope,
  parseElanousUiEnvelope,
  parseElanousTermCapabilities,
  emitElanousTermCapabilitiesMeta,
  ELANOUS_TERM_DISABLED,
  ELANOUS_TERM_FULL,
} from '../src/acp/elanous-extensions';

describe('ElanousTermEnvelope', () => {
  test('terminalOutput round-trip preserves bytes', () => {
    const env = formatElanousTermEnvelope({
      method: 'terminalOutput',
      payload: { terminalId: 'preview-1', data: 'hello\nworld\r\n' },
    });
    const parsed = parseElanousTermEnvelope(env);
    expect(parsed).not.toBeNull();
    expect(parsed!.method).toBe('terminalOutput');
    expect(parsed!.payload).toEqual({
      terminalId: 'preview-1',
      data: 'hello\nworld\r\n',
    });
  });

  test('terminalExit round-trip preserves code', () => {
    const env = formatElanousTermEnvelope({
      method: 'terminalExit',
      payload: { terminalId: 'preview-1', code: 137 },
    });
    const parsed = parseElanousTermEnvelope(env);
    expect(parsed).not.toBeNull();
    expect(parsed!.method).toBe('terminalExit');
    expect(parsed!.payload).toEqual({ terminalId: 'preview-1', code: 137 });
  });

  test('rejects bare text that is not an envelope', () => {
    expect(parseElanousTermEnvelope('plain agent thought')).toBeNull();
    expect(parseElanousTermEnvelope('')).toBeNull();
    expect(parseElanousTermEnvelope('[notify:relay] hello')).toBeNull();
  });

  test('rejects unknown methods', () => {
    const broken = '[elanous/term/exfilSecrets] preview-1\n{}\n<<elanous-term-end preview-1>>';
    expect(parseElanousTermEnvelope(broken)).toBeNull();
  });

  test('rejects payload missing required fields', () => {
    const noTid = '[elanous/term/terminalOutput] x\n{"data":"hi"}\n<<elanous-term-end x>>';
    expect(parseElanousTermEnvelope(noTid)).toBeNull();
    const noData = '[elanous/term/terminalOutput] x\n{"terminalId":"x"}\n<<elanous-term-end x>>';
    expect(parseElanousTermEnvelope(noData)).toBeNull();
    const noCode = '[elanous/term/terminalExit] x\n{"terminalId":"x"}\n<<elanous-term-end x>>';
    expect(parseElanousTermEnvelope(noCode)).toBeNull();
  });

  test('handles JSON parse failure gracefully', () => {
    const broken = '[elanous/term/terminalOutput] x\nnot-json{\n<<elanous-term-end x>>';
    expect(parseElanousTermEnvelope(broken)).toBeNull();
  });

  test('embedded newlines in data survive round-trip', () => {
    const data = 'line1\nline2\n\x1b[31mred\x1b[0m\n';
    const env = formatElanousTermEnvelope({
      method: 'terminalOutput',
      payload: { terminalId: 't', data },
    });
    const parsed = parseElanousTermEnvelope(env);
    expect(parsed?.payload).toMatchObject({ terminalId: 't', data });
  });
});

describe('ElanousTermEnvelope · sentinel disjoint from ElanousUiEnvelope', () => {
  test('UI envelope text does not parse as a term envelope', () => {
    const ui = formatElanousUiEnvelope({
      method: 'showToast',
      payload: { id: 'a', tone: 'info', text: 'hi' },
    });
    expect(parseElanousTermEnvelope(ui)).toBeNull();
  });

  test('term envelope text does not parse as a UI envelope', () => {
    const term = formatElanousTermEnvelope({
      method: 'terminalOutput',
      payload: { terminalId: 'a', data: 'x' },
    });
    expect(parseElanousUiEnvelope(term)).toBeNull();
  });
});

describe('ElanousTermClientCapabilities', () => {
  test('parse returns DISABLED on missing meta', () => {
    expect(parseElanousTermCapabilities(undefined)).toEqual(ELANOUS_TERM_DISABLED);
    expect(parseElanousTermCapabilities(null)).toEqual(ELANOUS_TERM_DISABLED);
    expect(parseElanousTermCapabilities({})).toEqual(ELANOUS_TERM_DISABLED);
    expect(parseElanousTermCapabilities({ elanous: {} })).toEqual(ELANOUS_TERM_DISABLED);
  });

  test('parse picks up declared flags', () => {
    const meta = emitElanousTermCapabilitiesMeta(ELANOUS_TERM_FULL);
    expect(parseElanousTermCapabilities(meta)).toEqual(ELANOUS_TERM_FULL);
  });

  test('parse treats unknown values as false', () => {
    const meta = { elanous: { term: { terminalOutput: 1, terminalExit: 'yes' } } };
    expect(parseElanousTermCapabilities(meta)).toEqual(ELANOUS_TERM_DISABLED);
  });
});
