import { describe, expect, test } from 'bun:test';

import { collectGroundingFactsViaCdp } from '../src/product-grounding/cdp-collect.js';

const readyStateExpression = "document.readyState === 'complete'";

describe('collectGroundingFactsViaCdp', () => {
  test('navigates, waits for readiness, returns the snippet result, and closes its target', async () => {
    const calls: string[] = [];
    const result = await collectGroundingFactsViaCdp('https://shop.example/item', 'collect()', {
      createClient: async () => ({
        navigate: async (url) => { calls.push(`navigate:${url}`); return { frameId: 'frame' }; },
        evaluate: async (expression) => {
          calls.push(`evaluate:${expression}`);
          return expression === readyStateExpression ? true : { title: 'item' };
        },
        close: async () => { calls.push('close'); },
      }),
    });

    expect(result).toEqual({ title: 'item' });
    expect(calls).toEqual([
      'navigate:https://shop.example/item',
      `evaluate:${readyStateExpression}`,
      'evaluate:collect()',
      'close',
    ]);
  });

  test('bounds readiness polling before evaluating the supplied snippet', async () => {
    const expressions: string[] = [];
    const sleeps: number[] = [];
    await collectGroundingFactsViaCdp('https://shop.example/item', 'collect()', {
      maxReadyStateChecks: 3,
      sleep: async (ms) => { sleeps.push(ms); },
      createClient: async () => ({
        navigate: async () => ({ frameId: 'frame' }),
        evaluate: async (expression) => {
          expressions.push(expression);
          return expression === readyStateExpression ? false : { collected: true };
        },
        close: async () => {},
      }),
    });

    expect(expressions).toEqual([readyStateExpression, readyStateExpression, readyStateExpression, 'collect()']);
    expect(sleeps).toEqual([100, 100]);
  });

  test('propagates connection failure instead of returning empty facts', async () => {
    await expect(collectGroundingFactsViaCdp('https://shop.example/item', 'collect()', {
      createClient: async () => { throw new Error('CDP unavailable'); },
    })).rejects.toThrow('CDP unavailable');
  });

  test('closes its opened target when snippet evaluation fails', async () => {
    let closed = false;
    await expect(collectGroundingFactsViaCdp('https://shop.example/item', 'collect()', {
      createClient: async () => ({
        navigate: async () => ({ frameId: 'frame' }),
        evaluate: async (expression) => {
          if (expression === readyStateExpression) return true;
          throw new Error('evaluation failed');
        },
        close: async () => { closed = true; },
      }),
    })).rejects.toThrow('evaluation failed');

    expect(closed).toBe(true);
  });
});
