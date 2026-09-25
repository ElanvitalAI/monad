// FU8 follow-up #1 (2026-05-12) — KGS Mission card cross-link tests.

import { describe, expect, test } from 'bun:test';

import {
  MISSION_CARD_ID_PREFIX,
  createMissionCard,
  mintMissionCardId,
  parseMissionCardId,
} from '../../src/knowledge/kgs/mission-card';

describe('mintMissionCardId / parseMissionCardId · URN round-trip', () => {
  test('mintMissionCardId prefixes a raw mission id', () => {
    expect(mintMissionCardId('m-abc123')).toBe('mission:m-abc123');
  });

  test('mintMissionCardId is idempotent on already-prefixed ids', () => {
    expect(mintMissionCardId('mission:m-abc123')).toBe('mission:m-abc123');
  });

  test('mintMissionCardId rejects empty / whitespace-only input', () => {
    expect(() => mintMissionCardId('')).toThrow();
    expect(() => mintMissionCardId('   ')).toThrow();
  });

  test('parseMissionCardId extracts the raw id from a URN', () => {
    expect(parseMissionCardId('mission:m-abc123')).toBe('m-abc123');
  });

  test('parseMissionCardId returns null for non-URN input', () => {
    expect(parseMissionCardId('m-abc123')).toBeNull();
    expect(parseMissionCardId('')).toBeNull();
    expect(parseMissionCardId('mission:')).toBeNull();
  });

  test('MISSION_CARD_ID_PREFIX is the documented constant', () => {
    expect(MISSION_CARD_ID_PREFIX).toBe('mission:');
  });
});

describe('createMissionCard · seeds the cross-link card', () => {
  test('produces a card with the URN id, mission source, and proper seed fields', () => {
    const card = createMissionCard({
      missionId: 'm-abc',
      title: 'Test mission',
      intent: 'do the thing',
      intakeId: 'intake-001',
      sourceWorkflowIds: ['/abs/path/wf-1.yaml', '/abs/path/wf-2.yaml'],
      sourceTaskCount: 2,
      now: 1_700_000_000_000,
    });
    expect(card.id).toBe('mission:m-abc');
    expect(card.source).toEqual({ kind: 'mission', missionId: 'm-abc' });
    expect(card.missionId).toBe('m-abc');
    expect(card.nature).toBe('principle');
    expect(card.kind).toBe('note');
    expect(card.reliability).toBe('verified');
    expect(card.domain).toBe('intake');
    expect(card.title).toBe('Test mission');
    // Body carries intent + task count + workflow refs + intake ref.
    expect(card.body).toContain('do the thing');
    expect(card.body).toContain('tasks: 2');
    expect(card.body).toContain('wf-1.yaml');
    expect(card.body).toContain('intake-001');
    expect(card.relatedIds).toEqual([
      '/abs/path/wf-1.yaml',
      '/abs/path/wf-2.yaml',
    ]);
    expect(card.tags).toEqual(['intake', 'mission']);
    // Deterministic timestamps from injected `now`.
    expect(card.createdAt).toBe(new Date(1_700_000_000_000).toISOString());
    expect(card.updatedAt).toBe(new Date(1_700_000_000_000).toISOString());
  });

  test('omits optional body lines when source fields are absent', () => {
    const card = createMissionCard({
      missionId: 'm-bare',
      title: 'Bare mission',
      intent: 'short intent',
      now: 1_700_000_000_000,
    });
    expect(card.body).toBe('short intent');
    // relatedIds undefined when no workflows.
    expect(card.relatedIds).toBeUndefined();
  });

  test('throws when the input mission id is empty', () => {
    expect(() =>
      createMissionCard({
        missionId: '',
        title: 't',
        intent: 'i',
        now: 1,
      }),
    ).toThrow();
  });
});
