import { expect, test } from 'bun:test';
import { buildIntakeDocumentStageCallables } from './runtime-callables.js';
import { parsePreprocessCallerText } from './check.js';

test('document preprocessing asks for affirmative claims and rejects an unsafe negative reply', async () => {
  let prompt = '';
  const callables = buildIntakeDocumentStageCallables({
    resolveRoleProvider: () => ({ provider: { name: 'stub' } }),
    streamLLM: async (messages) => {
      prompt = messages[0]?.content ?? '';
      return JSON.stringify({ claims: [{ text: 'elanous 는 기능을 보유하지 않는다', quote: 'outside quote', lens: 'L1 능력' }], discards: [] });
    },
  });
  const parsed = parsePreprocessCallerText(await callables.preprocess({ document: 'outside quote', lenses: ['L1 능력'] }), 'outside quote');
  expect(prompt).toContain('반드시 긍정형 존재·능력 문장');
  expect(parsed.claims).toEqual([]);
  expect(parsed.discards[0]?.reason).toContain('보유하지 않는다');
});
