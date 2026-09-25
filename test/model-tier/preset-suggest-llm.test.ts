// M2-4 v2 (Phase 3) — LLM-backed preset suggester tests.
//
// Uses an injected `runLlm` callback so we exercise prompt build,
// reply parsing, timeout, and fallback paths without a real network
// call. The integration with LM Studio is covered separately by the
// CLI smoke test in `test/cli/voice-suggest.test.ts` (M2-4 v2 CLI
// follow-up).

import { describe, expect, test } from 'bun:test';
import {
  buildPresetSuggestMessages,
  parsePresetSuggestReply,
  suggestPresetForTextLLM,
  type LlmMessage,
} from '../../src/model-tier/preset-suggest-llm.js';

describe('M2-4 v2 · buildPresetSuggestMessages', () => {
  test('emits system + user messages with all 5 presets listed', () => {
    const msgs = buildPresetSuggestMessages('Doctor visit prep');
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[1]!.role).toBe('user');
    expect(msgs[1]!.content).toBe('Doctor visit prep');
    const sys = msgs[0]!.content;
    expect(sys).toContain('casual_chat');
    expect(sys).toContain('meeting');
    expect(sys).toContain('medical_dictation');
    expect(sys).toContain('live_caption');
    expect(sys).toContain('sleep_mode');
    expect(sys).toContain('matchedKeywords');
    expect(sys).toContain('preset');
    expect(sys).toContain('confidence');
  });
});

describe('M2-4 v2 · parsePresetSuggestReply', () => {
  test('parses a clean single-line JSON object', () => {
    const r = parsePresetSuggestReply(
      '{"preset":"medical_dictation","confidence":0.92,"matchedKeywords":["doctor","prescription"]}',
    );
    expect(r?.preset).toBe('medical_dictation');
    expect(r?.confidence).toBe(0.92);
    expect(r?.matchedKeywords).toEqual(['doctor', 'prescription']);
    expect(r?.source).toBe('llm');
  });

  test('strips Markdown code fence wrappers', () => {
    const r = parsePresetSuggestReply(
      '```json\n{"preset":"meeting","confidence":0.7,"matchedKeywords":["standup"]}\n```',
    );
    expect(r?.preset).toBe('meeting');
    expect(r?.matchedKeywords).toEqual(['standup']);
  });

  test('tolerates leading prose before the JSON object', () => {
    const r = parsePresetSuggestReply(
      'Sure! Here is the answer: {"preset":"live_caption","confidence":0.6,"matchedKeywords":["subtitle"]}',
    );
    expect(r?.preset).toBe('live_caption');
  });

  test('clamps out-of-range confidence to [0, 1]', () => {
    const high = parsePresetSuggestReply(
      '{"preset":"meeting","confidence":1.7,"matchedKeywords":[]}',
    );
    expect(high?.confidence).toBe(1);
    const low = parsePresetSuggestReply(
      '{"preset":"meeting","confidence":-0.5,"matchedKeywords":[]}',
    );
    expect(low?.confidence).toBe(0);
  });

  test('rejects unknown preset id', () => {
    const r = parsePresetSuggestReply(
      '{"preset":"financial_advice","confidence":0.9,"matchedKeywords":[]}',
    );
    expect(r).toBeNull();
  });

  test('rejects malformed JSON', () => {
    expect(parsePresetSuggestReply('not a json')).toBeNull();
    expect(parsePresetSuggestReply('{"preset":')).toBeNull();
  });

  test('rejects non-object payloads', () => {
    expect(parsePresetSuggestReply('[1,2,3]')).toBeNull();
    expect(parsePresetSuggestReply('"medical_dictation"')).toBeNull();
  });

  test('defaults missing confidence to 0.5', () => {
    const r = parsePresetSuggestReply(
      '{"preset":"sleep_mode","matchedKeywords":["overnight"]}',
    );
    expect(r?.confidence).toBe(0.5);
  });

  test('coerces non-string matchedKeywords entries away', () => {
    const r = parsePresetSuggestReply(
      '{"preset":"casual_chat","confidence":0.3,"matchedKeywords":["dm",42,null,"sms"]}',
    );
    expect(r?.matchedKeywords).toEqual(['dm', 'sms']);
  });
});

describe('M2-4 v2 · suggestPresetForTextLLM', () => {
  const okRunner = async (messages: readonly LlmMessage[]): Promise<string> => {
    // Echo confirms the runner saw the user content; we always emit a
    // valid JSON pointing at medical_dictation regardless to keep the
    // assertion stable.
    void messages;
    return '{"preset":"medical_dictation","confidence":0.85,"matchedKeywords":["doctor"]}';
  };

  test('happy path: LLM response taken verbatim · source = llm', async () => {
    const r = await suggestPresetForTextLLM('I need to prep my deposition', okRunner);
    expect(r.preset).toBe('medical_dictation');
    expect(r.source).toBe('llm');
    expect(r.confidence).toBe(0.85);
    expect(r.rawReply).toContain('medical_dictation');
  });

  test('runner throws → falls back to heuristic', async () => {
    const r = await suggestPresetForTextLLM(
      'Doctor visit · prescription details',
      async () => { throw new Error('boom'); },
    );
    expect(r.source).toBe('fallback');
    // Heuristic still picks medical_dictation thanks to "doctor"
    // + "prescription" keywords.
    expect(r.preset).toBe('medical_dictation');
  });

  test('runner returns unparseable text → falls back to heuristic', async () => {
    const r = await suggestPresetForTextLLM(
      'standup minutes for the engineering team',
      async () => 'I think this is a meeting?',
    );
    expect(r.source).toBe('fallback');
    expect(r.preset).toBe('meeting');
  });

  test('empty text short-circuits without calling the LLM', async () => {
    let called = false;
    const r = await suggestPresetForTextLLM('', async () => { called = true; return ''; });
    expect(called).toBe(false);
    expect(r.source).toBe('fallback');
  });

  test('timeout enforced — slow runner falls back', async () => {
    const slowRunner = (): Promise<string> => new Promise((resolve) => {
      setTimeout(() => resolve('{"preset":"meeting","confidence":0.4,"matchedKeywords":[]}'), 200);
    });
    const r = await suggestPresetForTextLLM(
      'engineering standup notes for Mon AM',
      slowRunner,
      { timeoutMs: 30 },
    );
    expect(r.source).toBe('fallback');
    // Heuristic should still resolve meeting from the keywords.
    expect(r.preset).toBe('meeting');
  });

  test('LLM disagrees with heuristic on novel phrase · LLM wins', async () => {
    // Text has no keyword hits — heuristic would fallback to casual_chat
    // with confidence 0. LLM correctly classifies as live_caption.
    const r = await suggestPresetForTextLLM(
      'narrate the awards ceremony in real time for hearing-impaired viewers',
      async () => '{"preset":"live_caption","confidence":0.9,"matchedKeywords":["narrate","real time"]}',
    );
    expect(r.preset).toBe('live_caption');
    expect(r.source).toBe('llm');
  });
});
