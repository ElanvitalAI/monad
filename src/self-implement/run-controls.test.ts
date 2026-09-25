import { describe, expect, test } from 'bun:test';
import { RUN_CONTROLS, parseRunControlPrefix, resolveRunControl } from './run-controls.js';

describe('run controls', () => {
  test('exports the closed graph control registry', () => {
    expect(RUN_CONTROLS.graph).toMatchObject({ key: 'graph', describe: expect.any(String) });
    expect(RUN_CONTROLS.graph.parse('on')).toBe(true);
    expect(RUN_CONTROLS.graph.parse('off')).toBe(false);
  });

  test('parses only leading control lines and reports unknown keys without throwing', () => {
    expect(parseRunControlPrefix('제어: graph=on\n제어: unknown=value\n\nbody'))
      .toEqual({
        controls: { graph: true },
        rejections: [{ key: 'unknown', value: 'value', reason: 'unknown-key' }],
      });
  });

  test('resolves prefix, flag, config, then default with source metadata', () => {
    expect(resolveRunControl('graph', {
      prefix: { graph: true }, flag: { graph: false }, config: { graph: false },
    })).toEqual({ value: true, source: 'prefix' });
    expect(resolveRunControl('graph', {
      flag: { graph: false }, config: { graph: true },
    })).toEqual({ value: false, source: 'flag' });
    expect(resolveRunControl('graph', { config: { graph: true } }))
      .toEqual({ value: true, source: 'config' });
    // ⛔ 2026-09-10: 기본이 «켜짐»으로 뒤집혔다(대표 「그래프 방식이 기본이다」). 출처는 여전히 default 다.
    expect(resolveRunControl('graph', {})).toEqual({ value: true, source: 'default' });
  });
});
