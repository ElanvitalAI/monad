import { describe, expect, test } from 'bun:test';
import { emitDetachedProgress, emitHarnessFeedbackProgress } from '../index.js';
import {
  DETACHED_PROGRESS_FRAME_PREFIX,
  decodeDetachedProgressFrame,
  parseDetachedStdout,
} from './dispatch-detached.js';
import type { FeedbackEnvelope } from '../feedback/envelope.js';

function progressEnvelope(overrides: Partial<FeedbackEnvelope> = {}): FeedbackEnvelope {
  return {
    envelopeVersion: 1,
    sessionId: 'session-literal',
    blockId: 'block-literal',
    phase: 'delta',
    emittedAt: 1,
    seq: 7,
    asciiFallback: ['fallback line'],
    kind: 'tool.progress',
    payload: { stream: 'stdout', lines: ['human line'] },
    ...overrides,
  } as FeedbackEnvelope;
}

describe('emitDetachedProgress', () => {
  test('emits legacy human progress before a decodable structured frame', () => {
    const lines: string[] = [];
    const envelope = progressEnvelope();

    emitDetachedProgress(envelope, (line) => { lines.push(line); });

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('PROGRESS:human line\n');
    expect(lines[1]).toStartWith(DETACHED_PROGRESS_FRAME_PREFIX);
    const decoded = decodeDetachedProgressFrame(lines[1].trim());
    expect(decoded).not.toBeNull();
    if (!decoded) throw new Error('expected a detached progress frame');
    expect(decoded.kind).toBe('step');
    expect(decoded.stepId).toBe('delta');
    expect(decoded.seq).toBe(7);
    expect(decoded.planId).toBe('block-literal');
    expect(decoded.humanLine).toBe('human line');

    const parsed = parseDetachedStdout(lines.join(''));
    expect(parsed.progress).toHaveLength(1);
    expect(parsed.structuredProgress).toHaveLength(1);
    expect(parsed.progress[0]).toBe('human line');
    expect(parsed.structuredProgress[0]).toEqual(decoded);
  });

  test('uses a completed step identity from the envelope payload', () => {
    const lines: string[] = [];
    const envelope = progressEnvelope({
      phase: 'update',
      asciiFallback: [],
      payload: { stream: 'generic', lines: [], stepId: 'plan-ref:1:Run tests' } as never,
    });

    emitDetachedProgress(envelope, (line) => { lines.push(line); });

    expect(lines).toHaveLength(1);
    const frame = decodeDetachedProgressFrame(lines[0].trim());
    expect(frame).toMatchObject({
      kind: 'step',
      stepId: 'plan-ref:1:Run tests',
      planId: 'block-literal',
    });
  });

  test('emits only the structured frame when no human line is available', () => {
    const lines: string[] = [];
    const envelope = progressEnvelope({
      asciiFallback: [],
      payload: { stream: 'stdout', lines: [] },
    });

    emitDetachedProgress(envelope, (line) => { lines.push(line); });

    expect(lines.some((line) => line.startsWith('PROGRESS:'))).toBeFalse();
    expect(lines).toHaveLength(1);
    const frame = decodeDetachedProgressFrame(lines[0].trim());
    expect(frame).not.toBeNull();
    expect(frame?.kind).toBe('step');
    expect(frame?.stepId).toBe('delta');
    expect(frame?.seq).toBe(7);
    expect(frame?.planId).toBe('block-literal');
    expect(frame?.humanLine).toBeUndefined();
  });
});

describe('emitHarnessFeedbackProgress', () => {
  test('emits readable and structured progress for plan and non-plan envelopes in input order', () => {
    const lines: string[] = [];
    const plan = progressEnvelope({
      kind: 'agent.plan',
      phase: 'delta',
      seq: 11,
      blockId: 'plan-block',
      payload: { ref: 'plan-ref', steps: [{ text: 'literal plan step', status: 'pending' }] },
      asciiFallback: ['plan update'],
    });
    const progress = progressEnvelope({
      kind: 'tool.progress',
      phase: 'delta',
      seq: 12,
      blockId: 'progress-block',
      payload: { stream: 'stdout', lines: ['tool update'] },
    });

    emitHarnessFeedbackProgress(plan, (line) => { lines.push(line); });
    const planLines = lines.slice();
    emitHarnessFeedbackProgress(progress, (line) => { lines.push(line); });
    const progressLines = lines.slice(planLines.length);

    expect(planLines).toHaveLength(2);
    expect(planLines[0]).toBe('PROGRESS:plan update\n');
    expect(planLines[1]).toStartWith(DETACHED_PROGRESS_FRAME_PREFIX);
    expect(progressLines).toHaveLength(2);
    expect(progressLines[0]).toBe('PROGRESS:tool update\n');
    expect(progressLines[1]).toStartWith(DETACHED_PROGRESS_FRAME_PREFIX);
    expect(lines.some((line) => line.startsWith('[plan]'))).toBeFalse();

    const planFrame = decodeDetachedProgressFrame(planLines[1].trim());
    const progressFrame = decodeDetachedProgressFrame(progressLines[1].trim());
    expect(planFrame?.kind).toBe('plan');
    expect(progressFrame?.kind).toBe('step');
    expect(planFrame?.seq).toBe(11);
    expect(progressFrame?.seq).toBe(12);
    expect(parseDetachedStdout(lines.join('')).structuredProgress.map((frame) => frame.seq)).toEqual([11, 12]);
  });
});
