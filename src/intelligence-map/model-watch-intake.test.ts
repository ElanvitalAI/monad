import { describe, expect, test } from 'bun:test';

import { PROVIDER_MODEL_SOURCES, runModelWatchIntake } from './model-watch-intake.js';

test('exports the six canonical provider sources with OpenAI Markdown surfaces', () => {
  expect(PROVIDER_MODEL_SOURCES).toEqual([
    { id: 'openai-pricing', url: 'https://developers.openai.com/api/docs/pricing.md', kind: 'provider' },
    { id: 'openai-models', url: 'https://developers.openai.com/api/docs/models.md', kind: 'provider' },
    { id: 'anthropic-models', url: 'https://docs.anthropic.com/en/docs/about-claude/models', kind: 'provider' },
    { id: 'anthropic-pricing', url: 'https://www.anthropic.com/pricing', kind: 'provider' },
    { id: 'google-gemini-models', url: 'https://ai.google.dev/gemini-api/docs/models', kind: 'provider' },
    { id: 'xai-models', url: 'https://docs.x.ai/docs/models', kind: 'provider' },
  ]);
});

const pages = [
  { source: 'completed-source', text: 'completed' },
  { source: 'deadline-source', text: 'deadline' },
  { source: 'error-source', text: 'error' },
];

describe('runModelWatchIntake', () => {
  test('keeps completed, deadline, and error classifications distinguishable while processing peers', async () => {
    const result = await runModelWatchIntake(pages, {
      runLlm: async (messages) => {
        const text = messages.at(-1)?.content;
        if (text === 'deadline') return new Promise<string>(() => {});
        if (text === 'error') throw new Error('classifier disconnected');
        return JSON.stringify({ models: [{ id: 'new-model', provider: 'openai' }] });
      },
    }, { classifyTimeoutMs: 10 });

    expect(result.candidates.map((candidate) => candidate.id)).toEqual(['new-model']);
    expect(result.perSource['completed-source']).toMatchObject({
      candidateCount: 1, status: 'completed', contentLength: 9,
    });
    expect(result.perSource['deadline-source']).toMatchObject({
      candidateCount: 0, status: 'deadline', contentLength: 8,
    });
    expect(result.perSource['error-source']).toMatchObject({
      candidateCount: 0, status: 'error', contentLength: 5, error: 'classifier disconnected',
    });
  });

  test.each([
    Object.create(null),
    { toString: () => { throw new Error('cannot stringify'); } },
  ])('isolates an unstringifiable source error and continues with its peer', async (thrown) => {
    const result = await runModelWatchIntake([
      { source: 'broken-source', text: 'broken' },
      { source: 'peer-source', text: 'peer' },
    ], {
      runLlm: (messages) => {
        if (messages.at(-1)?.content === 'broken') throw thrown;
        return Promise.resolve(JSON.stringify({ models: [{ id: 'peer-model', provider: 'openai' }] }));
      },
    });

    expect(result.perSource['broken-source']).toMatchObject({
      candidateCount: 0, status: 'error', error: 'classifier error unavailable',
    });
    expect(result.perSource['peer-source']).toMatchObject({ candidateCount: 1, status: 'completed' });
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(['peer-model']);
  });

  test.each([NaN, Number.MAX_VALUE])('isolates invalid now value %p as a per-source error', async (now) => {
    const result = await runModelWatchIntake([
      { source: 'invalid-time-source', text: 'invalid time' },
      { source: 'peer-source', text: 'peer' },
    ], {
      runLlm: async (messages) => {
        const text = messages.at(-1)?.content;
        return JSON.stringify({ models: text === 'peer' ? [{ id: 'peer-model', provider: 'openai' }] : [] });
      },
    }, { now });

    expect(result.perSource['invalid-time-source']).toMatchObject({
      candidateCount: 0, status: 'error', contentLength: 12,
    });
    expect(result.perSource['peer-source']).toMatchObject({
      candidateCount: 0, status: 'error', contentLength: 4,
    });
    expect(result.candidates).toEqual([]);
  });
});
