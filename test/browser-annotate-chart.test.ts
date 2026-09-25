import { describe, expect, test } from 'bun:test';

import { renderCandlestickChart } from '../src/browser-annotate/chart.js';
import type { Candlestick, CandlestickChartOptions } from '../src/browser-annotate/chart.js';
import { chartCoordinates } from '../src/browser-annotate/coords.js';

const candles = [
  { time: 1, open: 100, high: 110, low: 95, close: 108 },
  { time: 2, open: 108, high: 112, low: 102, close: 104 },
  { time: 10, open: 104, high: 115, low: 100, close: 104 },
] as const;

function reasonFor(input: readonly Candlestick[], options: CandlestickChartOptions = { width: 300, height: 200, padding: 20 }): string {
  const result = renderCandlestickChart(input, options);
  expect(result.ok).toBeFalse();
  return result.ok ? '' : result.reason;
}

function attributes(svg: string, kind: 'line' | 'rect', time: number): Record<string, number | string> {
  const element = svg.match(new RegExp(`<${kind}[^>]*data-time="${time}"[^>]*/>`))?.[0];
  expect(element).toBeDefined();
  return Object.fromEntries([...String(element).matchAll(/([\w-]+)="([^"]+)"/g)].map(([, key, value]) => [key, Number.isNaN(Number(value)) ? value : Number(value)]));
}

describe('renderCandlestickChart', () => {
  test('rejects each impossible input with a distinct non-throwing reason', () => {
    const empty = reasonFor([]);
    const single = reasonFor([candles[0]]);
    const identical = reasonFor(candles.map((candle) => ({ ...candle, open: 10, high: 10, low: 10, close: 10 })));
    const nonFinite = reasonFor([{ ...candles[0], close: Number.NaN }, candles[1]]);
    const subpixel = reasonFor(candles, { width: 2, height: 200, padding: 0 });

    expect(new Set([empty, single, identical, nonFinite, subpixel]).size).toBe(5);
  });

  test('rejects invalid OHLC relationships and non-positive dimensions or negative padding', () => {
    expect(reasonFor([{ ...candles[0], high: 99 }, candles[1]])).toContain('enclose');
    expect(reasonFor(candles, { width: -100, height: 100, padding: -100 })).toContain('positive');
  });

  test('rejects non-monotonic times, overflowing derived ranges, and subpixel plot height', () => {
    expect(reasonFor([{ ...candles[0], time: 1 }, { ...candles[1], time: 10 }, { ...candles[2], time: 2 }])).toContain('strictly increasing');
    expect(reasonFor([{ time: -Number.MAX_VALUE, open: -Number.MAX_VALUE, high: -Number.MAX_VALUE, low: -Number.MAX_VALUE, close: -Number.MAX_VALUE }, { time: Number.MAX_VALUE, open: Number.MAX_VALUE, high: Number.MAX_VALUE, low: Number.MAX_VALUE, close: Number.MAX_VALUE }])).toContain('range calculation');
    expect(reasonFor(candles, { width: 300, height: 40, padding: { top: 20, bottom: 20, left: 0, right: 0 } })).toContain('smaller than one pixel');
  });

  test('rejects a finite price range when IEEE-754 cannot create strict axis padding', () => {
    const tinyRange = [
      { time: 1, open: 0, high: 0, low: 0, close: 0 },
      { time: 2, open: Number.MIN_VALUE, high: Number.MIN_VALUE, low: Number.MIN_VALUE, close: Number.MIN_VALUE },
    ];

    expect(reasonFor(tinyRange)).toContain('strict finite padding');
  });

  test('renders a large valid series without spreading candle values into function arguments', () => {
    const manyCandles = Array.from({ length: 500_000 }, (_, index) => ({
      time: index,
      open: 100 + (index % 2),
      high: 102 + (index % 2),
      low: 99 + (index % 2),
      close: 101 + (index % 2),
    }));
    const result = renderCandlestickChart(manyCandles, { width: 500_000, height: 200, padding: 0 });

    expect(result.ok).toBeTrue();
    if (result.ok) expect(result.svg).toContain('data-time="499999"');
  });

  test('renders namespaced wick and body SVG with directional colors and a one-pixel flat body', () => {
    const result = renderCandlestickChart(candles, { width: 300, height: 200, padding: 20 });
    expect(result.ok).toBeTrue();
    if (!result.ok) return;

    expect(result.svg.startsWith('<svg')).toBeTrue();
    expect(result.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect((result.svg.match(/class="candle-wick"/g) ?? [])).toHaveLength(candles.length);
    expect((result.svg.match(/class="candle-body"/g) ?? [])).toHaveLength(candles.length);
    expect(result.svg).toContain('fill="#16a34a"');
    expect(result.svg).toContain('fill="#dc2626"');
    expect(result.svg).toContain('fill="#6b7280"');
    expect(attributes(result.svg, 'rect', 10).height).toBe(1);
  });

  test('matches every irregular-time candle center and actual body close edge to chartCoordinates', () => {
    const result = renderCandlestickChart(candles, { width: 300, height: 200, padding: 20 });
    expect(result.ok).toBeTrue();
    if (!result.ok) return;

    const coordinates = candles.map((candle) => chartCoordinates(result.anchors, { time: candle.time, price: candle.close }));
    expect(coordinates.every((coordinate) => coordinate.ok)).toBeTrue();
    if (coordinates.some((coordinate) => !coordinate.ok)) return;

    for (const [candle, coordinate] of candles.map((candle, index) => [candle, coordinates[index]] as const)) {
      if (!coordinate.ok) continue;
      const rect = attributes(result.svg, 'rect', candle.time);
      const wick = attributes(result.svg, 'line', candle.time);
      const rectCenter = Number(rect.x) + Number(rect.width) / 2;
      const closeEdge = candle.close > candle.open
        ? Number(rect.y)
        : candle.close < candle.open
          ? Number(rect.y) + Number(rect.height)
          : Number(rect.y) + Number(rect.height) / 2;
      expect(Math.abs(rectCenter - coordinate.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(closeEdge - coordinate.y)).toBeLessThanOrEqual(1);
      expect(Number(wick.x1)).toBeCloseTo(rectCenter, 8);
      expect(Number(wick.y1)).toBeLessThanOrEqual(Number(wick.y2));
    }
    const [first, middle, last] = coordinates;
    if (!first.ok || !middle.ok || !last.ok) return;
    expect(first.x).toBeGreaterThanOrEqual(result.plot.left);
    expect(last.x).toBeLessThanOrEqual(result.plot.left + result.plot.width);
    expect(first.x).toBeLessThan(middle.x);
    expect(middle.x).toBeLessThan(last.x);
  });
});
