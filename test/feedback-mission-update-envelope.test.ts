// cascade-zyu W8-A Phase 4 (2026-05-14) — `mission.update` envelope schema tests.
//
// Validates:
//   1. `mission.update` ∈ FEEDBACK_KINDS (registry + isFeedbackEnvelope gate)
//   2. makeEnvelope + payload type narrowing (TypeScript discriminated union)
//   3. serialize → parse round-trip preserves all payload fields
//   4. Optional fields (progress · etaIso · emoji) omit 시 valid
//   5. op discriminator (start/update/end) 가 envelope.phase 와 독립
//
// iOS-side mirror = apps/ios/ElanousiOS/ElanousiOS/Shared/Feedback/FeedbackEnvelope.swift

import { describe, expect, test } from 'bun:test';
import {
  createSeqTracker,
  FEEDBACK_KINDS,
  isFeedbackEnvelope,
  makeEnvelope,
  parseEnvelope,
  serializeEnvelope,
  type MissionUpdatePayload,
} from '../src/feedback/envelope.js';

const fixedClock = (t = 1_700_000_000_000): (() => number) => () => t;

const sampleStart: MissionUpdatePayload = {
  missionId: 'mission-001',
  title: 'PR cascade · v1.2 release',
  status: 'running',
  progress: 0,
  etaIso: '2026-05-14T12:00:00.000Z',
  emoji: '🚀',
  op: 'start',
};

const sampleUpdate: MissionUpdatePayload = {
  missionId: 'mission-001',
  title: 'PR cascade · v1.2 release',
  status: 'running',
  progress: 0.42,
  etaIso: '2026-05-14T12:05:00.000Z',
  op: 'update',
};

const sampleEndMinimal: MissionUpdatePayload = {
  missionId: 'mission-001',
  title: 'Build complete',
  status: 'done',
  op: 'end',
};

describe('feedback.envelope · mission.update kind', () => {
  test('kind 가 FEEDBACK_KINDS registry 에 등록됨', () => {
    expect(FEEDBACK_KINDS).toContain('mission.update');
  });

  test('makeEnvelope + payload narrowing 정합', () => {
    const seqTracker = createSeqTracker();
    const env = makeEnvelope(
      {
        kind: 'mission.update',
        sessionId: 'sid-test',
        blockId: 'sid-test:mission:mission-001',
        phase: 'update',
        payload: sampleUpdate,
        now: fixedClock(),
      },
      seqTracker,
    );

    expect(env.kind).toBe('mission.update');
    expect(env.envelopeVersion).toBe(1);
    expect(env.seq).toBe(1);
    expect(env.emittedAt).toBe(1_700_000_000_000);
    if (env.kind === 'mission.update') {
      expect(env.payload.missionId).toBe('mission-001');
      expect(env.payload.title).toBe('PR cascade · v1.2 release');
      expect(env.payload.status).toBe('running');
      expect(env.payload.progress).toBe(0.42);
      expect(env.payload.op).toBe('update');
    }
  });

  test('isFeedbackEnvelope gate 통과 (full payload)', () => {
    const seqTracker = createSeqTracker();
    const env = makeEnvelope(
      {
        kind: 'mission.update',
        sessionId: 'sid',
        blockId: 'sid:mission:m-1',
        phase: 'start',
        payload: sampleStart,
        now: fixedClock(),
      },
      seqTracker,
    );
    expect(isFeedbackEnvelope(env)).toBe(true);
  });

  test('serialize → parse round-trip 보존', () => {
    const seqTracker = createSeqTracker();
    const env = makeEnvelope(
      {
        kind: 'mission.update',
        sessionId: 'sid',
        blockId: 'sid:mission:m-2',
        phase: 'update',
        payload: sampleUpdate,
        now: fixedClock(),
      },
      seqTracker,
    );
    const wire = serializeEnvelope(env);
    const decoded = parseEnvelope(wire);

    expect(decoded.kind).toBe('mission.update');
    expect(decoded.sessionId).toBe('sid');
    expect(decoded.blockId).toBe('sid:mission:m-2');
    expect(decoded.seq).toBe(1);
    if (decoded.kind === 'mission.update') {
      expect(decoded.payload).toEqual(sampleUpdate);
    }
  });

  test('optional fields omit 시 valid (end op · status=done · progress/etaIso/emoji 없음)', () => {
    const seqTracker = createSeqTracker();
    const env = makeEnvelope(
      {
        kind: 'mission.update',
        sessionId: 'sid',
        blockId: 'sid:mission:m-3',
        phase: 'end',
        payload: sampleEndMinimal,
        now: fixedClock(),
      },
      seqTracker,
    );
    expect(isFeedbackEnvelope(env)).toBe(true);
    if (env.kind === 'mission.update') {
      expect(env.payload.progress).toBeUndefined();
      expect(env.payload.etaIso).toBeUndefined();
      expect(env.payload.emoji).toBeUndefined();
      expect(env.payload.op).toBe('end');
      expect(env.payload.status).toBe('done');
    }
  });

  test('op discriminator (start/update/end) 가 envelope.phase 와 독립', () => {
    // Live Activity 의 lifecycle action (op) 과 stream timing (phase) 가
    // semantically 분리됨을 schema-level 에서 보장. emit 측이 두 axis 자유 조합.
    const seqTracker = createSeqTracker();
    const startInUpdate = makeEnvelope(
      {
        kind: 'mission.update',
        sessionId: 'sid',
        blockId: 'sid:mission:m-4',
        phase: 'update',
        payload: { ...sampleStart, op: 'start' },
        now: fixedClock(),
      },
      seqTracker,
    );
    expect(startInUpdate.phase).toBe('update');
    if (startInUpdate.kind === 'mission.update') {
      expect(startInUpdate.payload.op).toBe('start');
    }
  });
});
