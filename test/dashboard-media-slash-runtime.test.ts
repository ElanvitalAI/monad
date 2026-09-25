import { describe, expect, test } from 'bun:test';

import { resolveDashboardMediaSlash } from '../src/dashboard/media-slash-runtime.js';

describe('resolveDashboardMediaSlash', () => {
  const mediaState = {
    lastAssistantRaw: '![architecture](https://example.com/arch.png)',
    lastAssistantRange: { start: 0, end: 1 },
    lastAssistantMode: 'rendered' as const,
  };

  test('reports status for the last assistant media preview', () => {
    expect(resolveDashboardMediaSlash(['status'], mediaState)).toEqual({
      action: { kind: 'none' },
      lines: [
        '  kind: picture',
        '  label: architecture',
        '  url: https://example.com/arch.png',
      ],
    });
  });

  test('requests open when a preview exists', () => {
    expect(resolveDashboardMediaSlash(['open'], mediaState)).toEqual({
      action: { kind: 'open' },
      lines: ['  opening picture: architecture'],
    });
  });

  test('returns a warning-style line when no preview exists', () => {
    expect(resolveDashboardMediaSlash(['open'], {
      lastAssistantRaw: 'plain answer',
      lastAssistantRange: { start: 0, end: 1 },
      lastAssistantMode: 'rendered',
    })).toEqual({
      action: { kind: 'none' },
      lines: ['  no media preview in last assistant output'],
    });
  });

  test('seeds a local sample image for media testing', () => {
    const result = resolveDashboardMediaSlash(['sample', 'image'], mediaState);
    expect(result.lines).toEqual(['  seeded picture sample into last assistant output']);
    expect(result.action.kind).toBe('seed-sample');
    if (result.action.kind !== 'seed-sample') throw new Error('expected sample action');
    expect(result.action.sampleKind).toBe('picture');
    expect(result.action.text).toContain('data:image/svg+xml');
  });

  test('clears the last assistant media preview state', () => {
    expect(resolveDashboardMediaSlash(['clear'], mediaState)).toEqual({
      action: { kind: 'clear' },
      lines: ['  cleared last assistant media preview sample'],
    });
  });
});
