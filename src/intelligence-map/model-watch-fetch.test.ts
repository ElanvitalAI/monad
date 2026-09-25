import { describe, expect, test } from 'bun:test';

import { fetchProviderModelPages } from './model-watch-fetch.js';

describe('fetchProviderModelPages', () => {
  test('keeps successful pages when another canonical source fails', async () => {
    const result = await fetchProviderModelPages({
      sources: [
        { id: 'available', url: 'https://available.test' },
        { id: 'offline', url: 'https://offline.test' },
      ],
      fetch: async (url) => {
        if (url.includes('offline')) throw new Error('network unavailable');
        return { ok: true, status: 200, text: async () => 'model document' };
      },
    });

    expect(result.pages).toEqual([{ source: 'available', text: 'model document' }]);
    expect(result.failures).toEqual([{
      id: 'offline', url: 'https://offline.test', error: 'network unavailable',
    }]);
  });

  test('reports non-success HTTP responses without aborting later sources', async () => {
    const result = await fetchProviderModelPages({
      sources: [{ id: 'missing', url: 'https://missing.test' }],
      fetch: async () => ({ ok: false, status: 404, text: async () => 'unused' }),
    });

    expect(result.pages).toEqual([]);
    expect(result.failures).toEqual([{ id: 'missing', url: 'https://missing.test', error: 'HTTP 404' }]);
  });

  test('times out a response body that stalls after headers while keeping concurrent success', async () => {
    const started = Date.now();
    const result = await fetchProviderModelPages({
      sources: [
        { id: 'body-stalled', url: 'https://body-stalled.test' },
        { id: 'available', url: 'https://available.test' },
      ],
      timeoutMs: 20,
      fetch: async (url, init) => {
        if (url.includes('body-stalled')) {
          return {
            ok: true,
            status: 200,
            text: () => new Promise<string>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
            }),
          };
        }
        return { ok: true, status: 200, text: async () => 'new model' };
      },
    });

    expect(Date.now() - started).toBeLessThan(500);
    expect(result.pages).toEqual([{ source: 'available', text: 'new model' }]);
    expect(result.failures).toEqual([{
      id: 'body-stalled', url: 'https://body-stalled.test', error: 'Request timed out after 20ms',
    }]);
  });

  test('times out a permanently pending source while keeping concurrent success', async () => {
    const started = Date.now();
    const result = await fetchProviderModelPages({
      sources: [
        { id: 'stalled', url: 'https://stalled.test' },
        { id: 'available', url: 'https://available.test' },
      ],
      timeoutMs: 20,
      fetch: async (url, init) => {
        if (url.includes('stalled')) {
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          });
        }
        return { ok: true, status: 200, text: async () => 'new model' };
      },
    });

    expect(Date.now() - started).toBeLessThan(500);
    expect(result.pages).toEqual([{ source: 'available', text: 'new model' }]);
    expect(result.failures).toEqual([{
      id: 'stalled', url: 'https://stalled.test', error: 'Request timed out after 20ms',
    }]);
  });
});
