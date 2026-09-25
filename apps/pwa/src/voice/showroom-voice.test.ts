import { describe, expect, test } from 'bun:test';
import {
  pickPersonaVoice,
  showroomUtterancePrefix,
  stableHashCode,
  voicesForLanguage,
} from './showroom-voice';

interface FakeVoice {
  voiceURI: string;
  name: string;
  lang: string;
  default: boolean;
  localService: boolean;
}

function v(name: string, lang: string): FakeVoice {
  return { voiceURI: name, name, lang, default: false, localService: true };
}

describe('showroom-voice · stableHashCode', () => {
  test('same input → same hash (deterministic)', () => {
    expect(stableHashCode('p-1')).toBe(stableHashCode('p-1'));
    expect(stableHashCode('panel-codex')).toBe(stableHashCode('panel-codex'));
  });

  test('different inputs → different hashes (collision unlikely for short ids)', () => {
    expect(stableHashCode('p-1')).not.toBe(stableHashCode('p-2'));
    expect(stableHashCode('codex')).not.toBe(stableHashCode('claude'));
  });

  test('always returns non-negative (unsigned 32-bit)', () => {
    for (const s of ['', 'a', 'panel-id-with-many-chars-to-force-overflow', '@codex-cli']) {
      const h = stableHashCode(s);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(h)).toBe(true);
    }
  });
});

describe('showroom-voice · voicesForLanguage', () => {
  const all = [
    v('Alex', 'en-US'),
    v('Samantha', 'en-US'),
    v('Daniel', 'en-GB'),
    v('Yuna', 'ko-KR'),
    v('Sora', 'ko-KR'),
  ] as unknown as SpeechSynthesisVoice[];

  test('exact match wins over prefix match', () => {
    const out = voicesForLanguage(all, 'en-US');
    expect(out.map((x) => x.name)).toEqual(['Alex', 'Samantha']);
  });

  test('prefix match when no exact', () => {
    const out = voicesForLanguage(all, 'en');
    expect(out.map((x) => x.name)).toEqual(['Alex', 'Samantha', 'Daniel']);
  });

  test('empty list when no match', () => {
    const out = voicesForLanguage(all, 'fr-FR');
    expect(out).toEqual([]);
  });

  test('empty input → empty output', () => {
    expect(voicesForLanguage([], 'ko-KR')).toEqual([]);
  });
});

describe('showroom-voice · pickPersonaVoice', () => {
  const koVoices = [
    v('Yuna', 'ko-KR'),
    v('Sora', 'ko-KR'),
    v('Heami', 'ko-KR'),
  ] as unknown as SpeechSynthesisVoice[];

  test('same panel id → same voice (stable across calls)', () => {
    const a = pickPersonaVoice({ panelId: 'p-codex', language: 'ko-KR', voices: koVoices });
    const b = pickPersonaVoice({ panelId: 'p-codex', language: 'ko-KR', voices: koVoices });
    expect(a).not.toBeNull();
    expect(a?.name).toBe(b?.name ?? '');
  });

  test('different panels → may pick different voices (round-robin via hash)', () => {
    const ids = ['p-codex', 'p-claude', 'p-gemini', 'p-grok', 'p-1', 'p-2', 'p-3', 'p-4'];
    const picks = new Set<string>();
    for (const id of ids) {
      const voice = pickPersonaVoice({ panelId: id, language: 'ko-KR', voices: koVoices });
      if (voice) picks.add(voice.name);
    }
    // At least 2 distinct voices for 8 different panel ids over 3 voices.
    expect(picks.size).toBeGreaterThanOrEqual(2);
  });

  test('returns null when no voice matches the language', () => {
    const out = pickPersonaVoice({
      panelId: 'p-codex',
      language: 'fr-FR',
      voices: koVoices,
    });
    expect(out).toBeNull();
  });

  test('returns null on empty voice list', () => {
    const out = pickPersonaVoice({
      panelId: 'p-codex',
      language: 'ko-KR',
      voices: [],
    });
    expect(out).toBeNull();
  });
});

describe('showroom-voice · showroomUtterancePrefix', () => {
  test('formats with @ + display name + mid-dot pause', () => {
    expect(showroomUtterancePrefix('codex')).toBe('@codex · ');
    expect(showroomUtterancePrefix('grok-1')).toBe('@grok-1 · ');
  });

  test('preserves spaces inside the display name (mention chip 표시 그대로)', () => {
    expect(showroomUtterancePrefix('claude (sonnet)')).toBe('@claude (sonnet) · ');
  });
});
