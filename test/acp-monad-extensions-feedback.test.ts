// PLAN-ios-rich-dev-feedback-hydrate · M1-S (2026-05-13) —
// MonadFeedbackEnvelope round-trip + sentinel disjoint-ness from the
// existing MonadUi / MonadTerm envelopes. All three share
// `agent_thought_chunk` transport so a sentinel collision would
// silently mis-route to the wrong renderer.

import { describe, expect, test } from 'bun:test';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import {
  formatMonadFeedbackEnvelope,
  parseMonadFeedbackEnvelope,
  formatMonadUiEnvelope,
  parseMonadUiEnvelope,
  formatMonadTermEnvelope,
  parseMonadTermEnvelope,
} from '../src/acp/monad-extensions';
import {
  createSeqTracker,
  makeEnvelope,
  type AgentThinkingPayload,
  type ToolDiffPayload,
} from '../src/feedback/envelope';

interface FeedbackEnvelopeVector {
  name: string;
  wire: string;
  expect: { accepted: boolean; result?: unknown };
}

const feedbackEnvelopeVectorsPath = join(import.meta.dir, '..', 'monad-feedback-envelope-vectors.json');
const canonicalFeedbackEnvelopeVectorsPath = realpathSync(
  join(import.meta.dir, '..', 'monad-feedback-envelope-vectors.json'),
);
const feedbackEnvelopeVectors = JSON.parse(
  readFileSync(feedbackEnvelopeVectorsPath, 'utf8'),
) as FeedbackEnvelopeVector[];

function assertCanonicalFeedbackEnvelopeVectorsPath(path: string): void {
  expect(realpathSync(path)).toBe(canonicalFeedbackEnvelopeVectorsPath);
}

function buildThinking(blockId: string) {
  const seqTracker = createSeqTracker();
  const payload: AgentThinkingPayload = {
    msg: 'reading source',
    metrics: { elapsedMs: 420, tokenCount: 17 },
  };
  return makeEnvelope(
    {
      kind: 'agent.thinking',
      phase: 'start',
      sessionId: 's-1',
      blockId,
      payload,
      asciiFallback: ['⌁ thinking'],
      now: () => 1_700_000_000_000,
    },
    seqTracker,
  );
}

function buildDiff(blockId: string) {
  const seqTracker = createSeqTracker();
  const payload: ToolDiffPayload = {
    filePath: 'src/x.ts',
    language: 'typescript',
    hunks: [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: [
          { kind: 'del', text: 'foo' },
          { kind: 'add', text: 'bar' },
        ],
      },
    ],
  };
  return makeEnvelope(
    {
      kind: 'tool.diff',
      phase: 'end',
      sessionId: 's-1',
      blockId,
      parentToolCallId: 'tc-3',
      payload,
      asciiFallback: ['-foo', '+bar'],
      now: () => 1_700_000_000_000,
    },
    seqTracker,
  );
}

describe('MonadFeedbackEnvelope', () => {
  test('loads every vector from the repository-root canonical source', () => {
    assertCanonicalFeedbackEnvelopeVectorsPath(feedbackEnvelopeVectorsPath);
  });

  test.each(feedbackEnvelopeVectors)('$name follows the shared feedback envelope contract', (vector) => {
    const parsed = parseMonadFeedbackEnvelope(vector.wire);
    expect(parsed).toEqual(
      (vector.expect.accepted ? vector.expect.result : null) as ReturnType<typeof parseMonadFeedbackEnvelope>,
    );
  });

  test('agent.thinking round-trip preserves all fields', () => {
    const env = buildThinking('s-1:thinking:t1');
    const text = formatMonadFeedbackEnvelope({ method: 'emit', payload: env });
    const parsed = parseMonadFeedbackEnvelope(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.method).toBe('emit');
    expect(parsed!.payload).toEqual(env);
  });

  test('tool.diff round-trip preserves typed payload narrowing', () => {
    const env = buildDiff('s-1:edit:tc-3');
    const text = formatMonadFeedbackEnvelope({ method: 'emit', payload: env });
    const parsed = parseMonadFeedbackEnvelope(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.payload.kind).toBe('tool.diff');
    if (parsed!.payload.kind === 'tool.diff') {
      expect(parsed!.payload.payload.filePath).toBe('src/x.ts');
      expect(parsed!.payload.payload.hunks).toHaveLength(1);
    }
  });

  test('blockId appears in head + tail sentinels', () => {
    const env = buildThinking('block-abc');
    const text = formatMonadFeedbackEnvelope({ method: 'emit', payload: env });
    expect(text.startsWith('[monad/feedback/emit] block-abc\n')).toBe(true);
    expect(text.endsWith('<<monad-feedback-end block-abc>>')).toBe(true);
  });

  test('rejects bare text / wrong namespace', () => {
    expect(parseMonadFeedbackEnvelope('plain agent thought')).toBeNull();
    expect(parseMonadFeedbackEnvelope('')).toBeNull();
    expect(parseMonadFeedbackEnvelope('[monad/ui/showModal] m1\n{}\n<<monad-ui-end m1>>')).toBeNull();
    expect(
      parseMonadFeedbackEnvelope(
        '[monad/term/terminalOutput] t1\n{"terminalId":"t1","data":"x"}\n<<monad-term-end t1>>',
      ),
    ).toBeNull();
  });

  test('rejects unknown methods', () => {
    const broken = '[monad/feedback/exfilSecrets] x\n{}\n<<monad-feedback-end x>>';
    expect(parseMonadFeedbackEnvelope(broken)).toBeNull();
  });

  test('rejects body that fails isFeedbackEnvelope validation', () => {
    const wrongVersion =
      '[monad/feedback/emit] x\n{"envelopeVersion":2,"sessionId":"s","blockId":"x","kind":"agent.thinking","phase":"start","emittedAt":1,"seq":1,"payload":{},"asciiFallback":[]}\n<<monad-feedback-end x>>';
    expect(parseMonadFeedbackEnvelope(wrongVersion)).toBeNull();

    const badKind =
      '[monad/feedback/emit] x\n{"envelopeVersion":1,"sessionId":"s","blockId":"x","kind":"banana","phase":"start","emittedAt":1,"seq":1,"payload":{},"asciiFallback":[]}\n<<monad-feedback-end x>>';
    expect(parseMonadFeedbackEnvelope(badKind)).toBeNull();
  });

  test('rejects malformed JSON body', () => {
    const bad = '[monad/feedback/emit] x\n{not json}\n<<monad-feedback-end x>>';
    expect(parseMonadFeedbackEnvelope(bad)).toBeNull();
  });
});

describe('sentinel disjoint-ness across UI / term / feedback envelopes', () => {
  test('UI parser rejects feedback wire', () => {
    const env = buildThinking('x');
    const text = formatMonadFeedbackEnvelope({ method: 'emit', payload: env });
    expect(parseMonadUiEnvelope(text)).toBeNull();
  });

  test('term parser rejects feedback wire', () => {
    const env = buildThinking('x');
    const text = formatMonadFeedbackEnvelope({ method: 'emit', payload: env });
    expect(parseMonadTermEnvelope(text)).toBeNull();
  });

  test('feedback parser rejects UI wire', () => {
    const uiText = formatMonadUiEnvelope({
      method: 'showToast',
      payload: { id: 't1', tone: 'info', text: 'hi' },
    });
    expect(parseMonadFeedbackEnvelope(uiText)).toBeNull();
  });

  test('feedback parser rejects term wire', () => {
    const termText = formatMonadTermEnvelope({
      method: 'terminalOutput',
      payload: { terminalId: 't1', data: 'hello' },
    });
    expect(parseMonadFeedbackEnvelope(termText)).toBeNull();
  });
});
