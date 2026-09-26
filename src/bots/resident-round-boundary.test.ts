import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TARGET_FILE = join(import.meta.dir, 'resident-round.ts');
const LIVENESS_VOCABULARY = ['verdict', 'alive', 'machine-dead', 'elanous-dead'] as const;

type LivenessTerm = typeof LIVENESS_VOCABULARY[number];

function detectLivenessTerms(source: string): LivenessTerm[] {
  return LIVENESS_VOCABULARY.filter((term) => source.includes(term));
}

describe('resident-round liveness boundary', () => {
  test('reads an existing target and checks a non-empty liveness vocabulary', () => {
    expect(existsSync(TARGET_FILE)).toBe(true);
    expect(LIVENESS_VOCABULARY.length).toBeGreaterThan(0);

    const source = readFileSync(TARGET_FILE, 'utf8');
    expect(detectLivenessTerms(source)).toEqual([]);
  });

  test('detects liveness vocabulary in a fake source body', () => {
    const fakeSource = "const verdict = 'alive'; // machine-dead elanous-dead";

    expect(detectLivenessTerms(fakeSource)).toEqual([...LIVENESS_VOCABULARY]);
  });
});
