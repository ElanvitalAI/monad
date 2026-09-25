import { describe, expect, test } from 'bun:test';
import { parseLayout, resolveLayout } from '../src/ui/layout/dsl.js';

describe('LC11 parseLayout', () => {
  test('parses fill', () => {
    expect(parseLayout('fill')).toEqual({ fill: true });
  });

  test('parses absolute position + size + pivot', () => {
    const r = parseLayout('x:8,y:5,w:33%,h:6,p:tl');
    expect(r).toEqual({
      x: { kind: 'abs', value: 8 },
      y: { kind: 'abs', value: 5 },
      w: { kind: 'pct', value: 33 },
      h: { kind: 'abs', value: 6 },
      pivot: 'tl',
    });
  });

  test('parses anchor form', () => {
    const r = parseLayout('t:2,r:4,w:40,h:10');
    expect(r).toEqual({
      w: { kind: 'abs', value: 40 },
      h: { kind: 'abs', value: 10 },
      anchor: {
        t: { kind: 'abs', value: 2 },
        r: { kind: 'abs', value: 4 },
      },
    });
  });

  test('empty input parses to empty spec', () => {
    expect(parseLayout('')).toEqual({});
  });

  test('whitespace tolerant', () => {
    const r = parseLayout('  x: 3 , y : 2 ');
    expect(r.x).toEqual({ kind: 'abs', value: 3 });
    expect(r.y).toEqual({ kind: 'abs', value: 2 });
  });

  test('rejects missing colon', () => {
    expect(() => parseLayout('xy')).toThrow();
  });

  test('rejects invalid pivot', () => {
    expect(() => parseLayout('p:zz')).toThrow();
  });

  test('rejects unknown key', () => {
    expect(() => parseLayout('q:1')).toThrow();
  });
});

describe('LC11 resolveLayout', () => {
  const parent = { width: 80, height: 24 };

  test('fill spans the whole parent', () => {
    const r = resolveLayout({ fill: true }, parent);
    expect(r).toEqual({ x: 0, y: 0, width: 80, height: 24 });
  });

  test('absolute positioning with top-left pivot', () => {
    const r = resolveLayout(parseLayout('x:10,y:4,w:20,h:6,p:tl'), parent);
    expect(r).toEqual({ x: 10, y: 4, width: 20, height: 6 });
  });

  test('center pivot places around the point', () => {
    const r = resolveLayout(parseLayout('x:40,y:12,w:20,h:6,p:cc'), parent);
    expect(r).toEqual({ x: 30, y: 9, width: 20, height: 6 });
  });

  test('percent size scales to parent', () => {
    const r = resolveLayout(parseLayout('x:0,y:0,w:50%,h:50%,p:tl'), parent);
    expect(r.width).toBe(40);
    expect(r.height).toBe(12);
  });

  test('anchor with l+r spans between edges', () => {
    const r = resolveLayout(parseLayout('l:4,r:6,t:1,h:8'), parent);
    expect(r).toEqual({ x: 4, y: 1, width: 70, height: 8 });
  });

  test('anchor r+w positions from right', () => {
    const r = resolveLayout(parseLayout('t:0,r:5,w:10,h:3'), parent);
    expect(r).toEqual({ x: 65, y: 0, width: 10, height: 3 });
  });

  test('clamps to parent bounds', () => {
    const r = resolveLayout(parseLayout('x:90,y:30,w:20,h:10,p:tl'), parent);
    expect(r.x + r.width).toBeLessThanOrEqual(parent.width);
    expect(r.y + r.height).toBeLessThanOrEqual(parent.height);
  });

  test('missing size defaults to parent', () => {
    const r = resolveLayout(parseLayout('x:0,y:0,p:tl'), parent);
    expect(r.width).toBe(80);
    expect(r.height).toBe(24);
  });
});
