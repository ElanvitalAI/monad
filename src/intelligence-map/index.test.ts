import { expect, test } from 'bun:test';

import {
  classifyModelsFromTextDetailed,
  type ClassifyStatus,
  type DetailedClassifyResult,
  type WatchSourceResult,
} from './index.js';

test('intelligence-map barrel exports detailed classifier and intake result types', async () => {
  const result: DetailedClassifyResult = await classifyModelsFromTextDetailed(
    'announcement',
    async () => JSON.stringify({ models: [] }),
  );
  const status: ClassifyStatus = result.status;
  const source: WatchSourceResult = { ...result, candidateCount: result.candidates.length };

  expect(status).toBe('completed');
  expect(source.candidateCount).toBe(0);
});
