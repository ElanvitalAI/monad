// M2-4 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 2) —
// Preset suggester (heuristic).

import { describe, expect, test } from 'bun:test';
import { suggestPresetForText } from '../../src/model-tier/preset-suggest.js';

describe('M2-4 · suggestPresetForText · medical_dictation', () => {
  test('explicit medical terms', () => {
    const r = suggestPresetForText('Doctor\'s notes from today\'s patient visit · prescription details');
    expect(r.preset).toBe('medical_dictation');
    expect(r.confidence).toBeGreaterThan(0.4);
    expect(r.matchedKeywords.length).toBeGreaterThan(0);
  });

  test('legal/court terms', () => {
    const r = suggestPresetForText('Lawyer prepared a deposition for the court hearing');
    expect(r.preset).toBe('medical_dictation');
    expect(r.confidence).toBeGreaterThan(0.4);
  });

  test('Korean medical terms', () => {
    const r = suggestPresetForText('환자 진단 및 처방 기록');
    expect(r.preset).toBe('medical_dictation');
  });
});

describe('M2-4 · suggestPresetForText · meeting', () => {
  test('standup keyword', () => {
    const r = suggestPresetForText('Engineering standup notes Mon AM');
    expect(r.preset).toBe('meeting');
    expect(r.confidence).toBeGreaterThan(0);
  });

  test('Korean meeting', () => {
    const r = suggestPresetForText('월간 회의 정리');
    expect(r.preset).toBe('meeting');
  });

  test('multiple meeting words', () => {
    const r = suggestPresetForText('Sync meeting · agenda · minutes');
    expect(r.preset).toBe('meeting');
    expect(r.confidence).toBeGreaterThanOrEqual(0.6);
  });
});

describe('M2-4 · suggestPresetForText · live_caption', () => {
  test('streaming context', () => {
    const r = suggestPresetForText('Live caption the keynote stream');
    expect(r.preset).toBe('live_caption');
  });

  test('subtitle/realtime', () => {
    const r = suggestPresetForText('Realtime subtitle for the broadcast');
    expect(r.preset).toBe('live_caption');
  });
});

describe('M2-4 · suggestPresetForText · sleep_mode', () => {
  test('overnight automation', () => {
    const r = suggestPresetForText('Overnight background indexer · offline only');
    expect(r.preset).toBe('sleep_mode');
  });

  test('Korean 심야', () => {
    const r = suggestPresetForText('심야 백그라운드 작업');
    expect(r.preset).toBe('sleep_mode');
  });
});

describe('M2-4 · suggestPresetForText · casual_chat fallback', () => {
  test('no matches → casual_chat with confidence 0', () => {
    const r = suggestPresetForText('the quick brown fox jumps');
    expect(r.preset).toBe('casual_chat');
    expect(r.confidence).toBe(0);
    expect(r.matchedKeywords).toEqual([]);
  });

  test('explicit reminder words → casual_chat with some confidence', () => {
    const r = suggestPresetForText('Quick reminder to ping the team');
    expect(r.preset).toBe('casual_chat');
    expect(r.confidence).toBeGreaterThan(0);
  });

  test('empty / whitespace → fallback', () => {
    expect(suggestPresetForText('').preset).toBe('casual_chat');
    expect(suggestPresetForText('   ').preset).toBe('casual_chat');
  });

  test('non-string input → fallback (defensive)', () => {
    expect(suggestPresetForText(42 as unknown as string).preset).toBe('casual_chat');
    expect(suggestPresetForText(null as unknown as string).preset).toBe('casual_chat');
  });
});

describe('M2-4 · suggestPresetForText · scoring + matchedKeywords', () => {
  test('confidence rises with more matches', () => {
    const single = suggestPresetForText('agenda');
    const multi = suggestPresetForText('agenda minutes standup retro kickoff');
    expect(multi.confidence).toBeGreaterThan(single.confidence);
  });

  test('confidence capped at 1.0', () => {
    const text = 'meeting standup sync planning retro kickoff agenda minutes review 1:1';
    const r = suggestPresetForText(text);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });

  test('matchedKeywords surfaces the actual hits', () => {
    const r = suggestPresetForText('Live keynote subtitle stream');
    expect(r.matchedKeywords).toContain('live');
    expect(r.matchedKeywords).toContain('subtitle');
    expect(r.matchedKeywords).toContain('stream');
  });

  test('mixed signals · stronger preset wins on weight', () => {
    // "meeting" + "medical" — medical has weight 2, meeting weight 1 ·
    // single match each but medical's weight wins.
    const r = suggestPresetForText('Quarterly meeting · medical record review');
    expect(r.preset).toBe('medical_dictation');
  });
});
