// Test: src/discord/embed-builder.ts
//
// Coverage: hex→int color · buildPersonaEmbed pure construction ·
// buildModelCostFooter formatting · timestamp handling.

import { describe, expect, test } from 'bun:test';
import {
  buildModelCostFooter,
  buildPersonaEmbed,
  hexColorToInt,
} from '../../src/discord/embed-builder.js';
import type { PersonaIdentity } from '../../src/discord/webhook-persona-adapter.js';

const SAGE: PersonaIdentity = {
  personaId: 'sage',
  displayName: 'Sage',
  avatarUrl: 'https://cdn.example/sage.png',
  brandColor: '#6d28d9',
};

const PRAGMA: PersonaIdentity = {
  personaId: 'pragmatist',
  displayName: 'Pragmatist',
};

describe('hexColorToInt', () => {
  test('parses 6-hex with leading #', () => {
    expect(hexColorToInt('#6d28d9')).toBe(0x6d28d9);
  });
  test('parses 6-hex without leading #', () => {
    expect(hexColorToInt('6d28d9')).toBe(0x6d28d9);
  });
  test('case-insensitive', () => {
    expect(hexColorToInt('#FFAA00')).toBe(0xffaa00);
  });
  test('returns undefined for missing', () => {
    expect(hexColorToInt(undefined)).toBeUndefined();
    expect(hexColorToInt('')).toBeUndefined();
  });
  test('returns undefined for invalid hex', () => {
    expect(hexColorToInt('xyz')).toBeUndefined();
    expect(hexColorToInt('#12345')).toBeUndefined();    // 5 chars
    expect(hexColorToInt('#1234567')).toBeUndefined();  // 7 chars
    expect(hexColorToInt('#xyz123')).toBeUndefined();
  });
});

describe('buildPersonaEmbed', () => {
  test('minimal — just author from persona', () => {
    const e = buildPersonaEmbed(SAGE, {});
    expect(e.author).toEqual({ name: 'Sage', icon_url: 'https://cdn.example/sage.png' });
    expect(e.color).toBe(0x6d28d9);
    expect(e.title).toBeUndefined();
    expect(e.description).toBeUndefined();
    expect(e.fields).toBeUndefined();
    expect(e.footer).toBeUndefined();
    expect(e.timestamp).toBeUndefined();
  });

  test('omits color when persona has no brandColor', () => {
    const e = buildPersonaEmbed(PRAGMA, { description: 'hi' });
    expect(e.color).toBeUndefined();
    expect(e.author).toEqual({ name: 'Pragmatist' });  // no icon_url
  });

  test('full spec — all fields propagate', () => {
    const e = buildPersonaEmbed(SAGE, {
      title: '신중하게 분석',
      description: '두 가지 trade-off 가 있습니다.',
      fields: [
        { name: '1차 효과', value: '...', inline: true },
        { name: '2차 효과', value: '...', inline: true },
      ],
      footerText: 'claude-opus-4-7 · $0.0142',
      footerIconUrl: 'https://cdn.example/footer.png',
      timestamp: '2026-05-01T12:34:56.789Z',
      thumbnailUrl: 'https://cdn.example/thumb.png',
    });
    expect(e.title).toBe('신중하게 분석');
    expect(e.description).toBe('두 가지 trade-off 가 있습니다.');
    expect(e.color).toBe(0x6d28d9);
    expect(e.fields).toEqual([
      { name: '1차 효과', value: '...', inline: true },
      { name: '2차 효과', value: '...', inline: true },
    ]);
    expect(e.footer).toEqual({
      text: 'claude-opus-4-7 · $0.0142',
      icon_url: 'https://cdn.example/footer.png',
    });
    expect(e.timestamp).toBe('2026-05-01T12:34:56.789Z');
    expect(e.thumbnail).toEqual({ url: 'https://cdn.example/thumb.png' });
  });

  test('Date timestamp serializes to ISO', () => {
    const d = new Date('2026-05-01T00:00:00Z');
    const e = buildPersonaEmbed(SAGE, { timestamp: d });
    expect(e.timestamp).toBe(d.toISOString());
  });

  test('includeTimestamp:true auto-fills when no explicit timestamp', () => {
    const before = new Date();
    const e = buildPersonaEmbed(SAGE, { includeTimestamp: true });
    expect(e.timestamp).toBeDefined();
    const t = new Date(e.timestamp!);
    // sanity: within 5 seconds of `before`
    expect(t.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(t.getTime() - before.getTime()).toBeLessThan(5000);
  });

  test('explicit timestamp wins over includeTimestamp', () => {
    const e = buildPersonaEmbed(SAGE, {
      timestamp: '2020-01-01T00:00:00Z',
      includeTimestamp: true,
    });
    expect(e.timestamp).toBe('2020-01-01T00:00:00Z');
  });

  test('empty fields array → undefined (no embed.fields)', () => {
    const e = buildPersonaEmbed(SAGE, { fields: [] });
    expect(e.fields).toBeUndefined();
  });

  test('field without inline does not include the inline key', () => {
    const e = buildPersonaEmbed(SAGE, {
      fields: [{ name: 'a', value: 'b' }],
    });
    expect(e.fields).toEqual([{ name: 'a', value: 'b' }]);
    expect(e.fields?.[0]).not.toHaveProperty('inline');
  });
});

describe('buildModelCostFooter', () => {
  test('model + cost', () => {
    expect(buildModelCostFooter({ model: 'claude-opus-4-7', costUsd: 0.0142 }))
      .toBe('claude-opus-4-7 · $0.0142');
  });
  test('cost precision override', () => {
    expect(buildModelCostFooter({ model: 'm', costUsd: 0.123456, costPrecision: 2 }))
      .toBe('m · $0.12');
  });
  test('model only', () => {
    expect(buildModelCostFooter({ model: 'claude-haiku-4-5' }))
      .toBe('claude-haiku-4-5');
  });
  test('cost only', () => {
    expect(buildModelCostFooter({ costUsd: 0.001 })).toBe('$0.0010');
  });
  test('zero cost is rendered (not skipped as falsy)', () => {
    expect(buildModelCostFooter({ costUsd: 0 })).toBe('$0.0000');
  });
  test('NaN/Infinity skipped', () => {
    expect(buildModelCostFooter({ costUsd: NaN })).toBeUndefined();
    expect(buildModelCostFooter({ costUsd: Infinity })).toBeUndefined();
  });
  test('empty input → undefined', () => {
    expect(buildModelCostFooter({})).toBeUndefined();
  });
});
