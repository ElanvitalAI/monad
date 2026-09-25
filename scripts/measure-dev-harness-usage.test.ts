import { expect, test } from 'bun:test';
import { measureDevHarnessUsage } from './measure-dev-harness-usage.js';

test('counts each promised form by ASK record and separates standalone harness from safe phrases', () => {
  const measured = measureDevHarnessUsage([
    '하니스로 개발해줘. 하니스로 개발도 해줘.',
    '하니스: 이 버그를 고쳐줘. 하니스 구현해줘.',
    'Use the harness to fix this bug; implement with the harness.',
    'self dev this feature.',
    'The harness is useful documentation.',
  ]);

  expect(measured.records).toBe(5);
  expect(measured.promised).toMatchObject({
    '하니스로 개발': 1,
    '하니스:': 1,
    '하니스로 구현해줘': 0,
    '하니스 구현': 1,
    harness: 2,
    'self dev': 1,
  });
  expect(measured.safePhrases).toMatchObject({
    '하니스:': 1,
    '하니스 구현': 1,
    'use the harness': 1,
    'implement with the harness': 1,
    'self dev': 1,
  });
  expect(measured.standaloneHarness).toBe(1);
  expect(measured.safeEnglishPhraseFiles).toBe(1);
  expect(measured.safeEnglishAndStandaloneHarnessFiles).toBe(0);
});

test('uses the same English word rule for raw, phrase, and standalone counts', () => {
  const measured = measureDevHarnessUsage([
    'RunDevHarness and harnessing are identifiers and derivatives.',
    'DEVELOP WITH THE HARNESS, then inspect the harness output.',
    'use the harness.',
    'A standalone HARNESS remains.',
  ]);

  expect(measured.promised.harness).toBe(3);
  expect(measured.safePhrases['develop with the harness']).toBe(1);
  expect(measured.safePhrases['use the harness']).toBe(1);
  expect(measured.standaloneHarness).toBe(2);
  expect(measured.safeEnglishPhraseFiles).toBe(2);
  expect(measured.safeEnglishAndStandaloneHarnessFiles).toBe(1);
});

test('excludes English safe phrases attached to derivatives or identifier characters', () => {
  const measured = measureDevHarnessUsage([
    'use the harnessing',
    'xuse the harness',
    'use the harnessX',
    'Use the harness; then inspect the harness output.',
  ]);

  expect(measured.promised.harness).toBe(2);
  expect(measured.safePhrases['use the harness']).toBe(1);
  expect(measured.standaloneHarness).toBe(2);
  expect(measured.safeEnglishPhraseFiles).toBe(1);
  expect(measured.safeEnglishAndStandaloneHarnessFiles).toBe(1);
});
