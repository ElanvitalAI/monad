import { describe, expect, test } from 'bun:test';
import { buildContextSeedEntry } from './mission-build-orchestrate.js';

describe('buildContextSeedEntry — ref grounding 전달', () => {
  test('refFacts만 있는 grounded 결과도 seed하고 decisions로 보존', () => {
    const entry = buildContextSeedEntry(
      { researched: false, enrichments: [], corrections: [], needReason: '' },
      {
        grounded: true,
        context: '참조 지식 1건',
        files: [],
        refFacts: ['[ref:lazycodex] /tmp/source/ref/lazycodex'],
      },
    );
    expect(entry).not.toBeNull();
    expect(entry!.reusables).toEqual([]);
    expect(entry!.decisions).toEqual(['[ref:lazycodex] /tmp/source/ref/lazycodex']);
  });
});
