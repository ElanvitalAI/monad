import { describe, expect, test } from 'bun:test';
import {
  mergeLayers,
  explainLayers,
  type Layer,
} from '../src/expression/config/layers.js';

interface Cfg {
  llm: { provider?: string; apiKey?: string; model?: string };
  obsidian: { vault?: string };
  skills: { activeSet?: string; dirs?: string[] };
}

describe('expression/config/layers · mergeLayers', () => {
  test('higher-priority layer overrides lower for same field', () => {
    const layers: Layer<Cfg>[] = [
      { source: 'defaults', value: { llm: { provider: 'openai', apiKey: 'k1' } } },
      { source: 'env', value: { llm: { apiKey: 'k2' } } },
    ];
    const merged = mergeLayers(layers);
    expect(merged.llm).toEqual({ provider: 'openai', apiKey: 'k2' });
  });

  test('arrays replace, not concat', () => {
    const layers: Layer<Cfg>[] = [
      { source: 'defaults', value: { skills: { dirs: ['a', 'b'] } } },
      { source: 'answer-file', value: { skills: { dirs: ['c'] } } },
    ];
    expect(mergeLayers(layers).skills.dirs).toEqual(['c']);
  });

  test('null clears a field set by a lower layer', () => {
    const layers: Layer<Cfg>[] = [
      { source: 'defaults', value: { llm: { apiKey: 'k1' } } },
      { source: 'env', value: { llm: { apiKey: null as unknown as string } } },
    ];
    expect(mergeLayers(layers).llm.apiKey).toBeUndefined();
  });

  test('5 layer priority chain — interactive beats env beats answer-file beats theme beats defaults', () => {
    const layers: Layer<{ x: number }>[] = [
      { source: 'defaults', value: { x: 1 } },
      { source: 'theme', value: { x: 2 } },
      { source: 'answer-file', value: { x: 3 } },
      { source: 'env', value: { x: 4 } },
      { source: 'interactive', value: { x: 5 } },
    ];
    expect(mergeLayers(layers).x).toBe(5);
  });

  test('nested objects merge recursively', () => {
    const layers: Layer<Cfg>[] = [
      { source: 'defaults', value: { llm: { provider: 'a', model: 'm1' } } },
      { source: 'answer-file', value: { llm: { apiKey: 'k' } } },
    ];
    expect(mergeLayers(layers).llm).toEqual({ provider: 'a', model: 'm1', apiKey: 'k' });
  });

  test('undefined keys do not override (passthrough)', () => {
    const layers: Layer<Cfg>[] = [
      { source: 'defaults', value: { llm: { apiKey: 'k1' } } },
      { source: 'env', value: { llm: { apiKey: undefined } } },
    ];
    expect(mergeLayers(layers).llm.apiKey).toBe('k1');
  });
});

describe('expression/config/layers · explainLayers', () => {
  test('reports the deepest layer that wrote each path', () => {
    const layers: Layer<Cfg>[] = [
      { source: 'defaults', value: { llm: { provider: 'a' } } },
      { source: 'env', value: { llm: { apiKey: 'k' } } },
    ];
    const sources = explainLayers(layers);
    expect(sources['llm.provider']).toBe('defaults');
    expect(sources['llm.apiKey']).toBe('env');
  });

  test('higher layer overrides the source when both wrote the field', () => {
    const layers: Layer<Cfg>[] = [
      { source: 'defaults', value: { llm: { apiKey: 'k1' } } },
      { source: 'env', value: { llm: { apiKey: 'k2' } } },
    ];
    expect(explainLayers(layers)['llm.apiKey']).toBe('env');
  });
});
