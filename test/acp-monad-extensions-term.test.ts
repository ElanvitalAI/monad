// WT-S-1 — MonadTermEnvelope round-trip + sentinel disjoint-ness from
// the existing MonadUiEnvelope. The two share `agent_thought_chunk`
// transport so any sentinel collision would silently mis-route.

import { describe, expect, test } from 'bun:test';
import {
  formatMonadTermEnvelope,
  parseMonadTermEnvelope,
  formatMonadUiEnvelope,
  parseMonadUiEnvelope,
  parseMonadTermCapabilities,
  emitMonadTermCapabilitiesMeta,
  MONAD_TERM_DISABLED,
  MONAD_TERM_FULL,
} from '../src/acp/monad-extensions';

describe('MonadTermEnvelope', () => {
  test('terminalOutput round-trip preserves bytes', () => {
    const env = formatMonadTermEnvelope({
      method: 'terminalOutput',
      payload: { terminalId: 'preview-1', data: 'hello\nworld\r\n' },
    });
    const parsed = parseMonadTermEnvelope(env);
    expect(parsed).not.toBeNull();
    expect(parsed!.method).toBe('terminalOutput');
    expect(parsed!.payload).toEqual({
      terminalId: 'preview-1',
      data: 'hello\nworld\r\n',
    });
  });

  test('terminalExit round-trip preserves code', () => {
    const env = formatMonadTermEnvelope({
      method: 'terminalExit',
      payload: { terminalId: 'preview-1', code: 137 },
    });
    const parsed = parseMonadTermEnvelope(env);
    expect(parsed).not.toBeNull();
    expect(parsed!.method).toBe('terminalExit');
    expect(parsed!.payload).toEqual({ terminalId: 'preview-1', code: 137 });
  });

  test('rejects bare text that is not an envelope', () => {
    expect(parseMonadTermEnvelope('plain agent thought')).toBeNull();
    expect(parseMonadTermEnvelope('')).toBeNull();
    expect(parseMonadTermEnvelope('[notify:relay] hello')).toBeNull();
  });

  test('rejects unknown methods', () => {
    const broken = '[monad/term/exfilSecrets] preview-1\n{}\n<<monad-term-end preview-1>>';
    expect(parseMonadTermEnvelope(broken)).toBeNull();
  });

  test('rejects payload missing required fields', () => {
    const noTid = '[monad/term/terminalOutput] x\n{"data":"hi"}\n<<monad-term-end x>>';
    expect(parseMonadTermEnvelope(noTid)).toBeNull();
    const noData = '[monad/term/terminalOutput] x\n{"terminalId":"x"}\n<<monad-term-end x>>';
    expect(parseMonadTermEnvelope(noData)).toBeNull();
    const noCode = '[monad/term/terminalExit] x\n{"terminalId":"x"}\n<<monad-term-end x>>';
    expect(parseMonadTermEnvelope(noCode)).toBeNull();
  });

  test('handles JSON parse failure gracefully', () => {
    const broken = '[monad/term/terminalOutput] x\nnot-json{\n<<monad-term-end x>>';
    expect(parseMonadTermEnvelope(broken)).toBeNull();
  });

  test('embedded newlines in data survive round-trip', () => {
    const data = 'line1\nline2\n\x1b[31mred\x1b[0m\n';
    const env = formatMonadTermEnvelope({
      method: 'terminalOutput',
      payload: { terminalId: 't', data },
    });
    const parsed = parseMonadTermEnvelope(env);
    expect(parsed?.payload).toMatchObject({ terminalId: 't', data });
  });
});

describe('MonadTermEnvelope · sentinel disjoint from MonadUiEnvelope', () => {
  test('UI envelope text does not parse as a term envelope', () => {
    const ui = formatMonadUiEnvelope({
      method: 'showToast',
      payload: { id: 'a', tone: 'info', text: 'hi' },
    });
    expect(parseMonadTermEnvelope(ui)).toBeNull();
  });

  test('term envelope text does not parse as a UI envelope', () => {
    const term = formatMonadTermEnvelope({
      method: 'terminalOutput',
      payload: { terminalId: 'a', data: 'x' },
    });
    expect(parseMonadUiEnvelope(term)).toBeNull();
  });
});

describe('MonadTermClientCapabilities', () => {
  test('parse returns DISABLED on missing meta', () => {
    expect(parseMonadTermCapabilities(undefined)).toEqual(MONAD_TERM_DISABLED);
    expect(parseMonadTermCapabilities(null)).toEqual(MONAD_TERM_DISABLED);
    expect(parseMonadTermCapabilities({})).toEqual(MONAD_TERM_DISABLED);
    expect(parseMonadTermCapabilities({ monad: {} })).toEqual(MONAD_TERM_DISABLED);
  });

  test('parse picks up declared flags', () => {
    const meta = emitMonadTermCapabilitiesMeta(MONAD_TERM_FULL);
    expect(parseMonadTermCapabilities(meta)).toEqual(MONAD_TERM_FULL);
  });

  test('parse treats unknown values as false', () => {
    const meta = { monad: { term: { terminalOutput: 1, terminalExit: 'yes' } } };
    expect(parseMonadTermCapabilities(meta)).toEqual(MONAD_TERM_DISABLED);
  });
});
