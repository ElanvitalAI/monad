import type { ChartAnchors } from './coords.js';
import { SVG_NAMESPACE } from './shapes.js';

export interface Candlestick {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ChartPadding {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface CandlestickChartOptions {
  width: number;
  height: number;
  padding?: number | ChartPadding;
}

export interface ChartPlot {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type CandlestickChartResult =
  | { ok: true; svg: string; anchors: ChartAnchors; plot: ChartPlot }
  | { ok: false; reason: string };

const RISING_COLOR = '#16a34a';
const FALLING_COLOR = '#dc2626';
const FLAT_COLOR = '#6b7280';
const PRICE_PADDING_RATIO = 0.05;

/** Renders supplied OHLC candles and the exact axes needed to annotate the result. */
export function renderCandlestickChart(
  candles: readonly Candlestick[],
  options: CandlestickChartOptions,
): CandlestickChartResult {
  if (candles.length === 0) return { ok: false, reason: 'cannot render an empty candle series' };
  if (candles.length === 1) return { ok: false, reason: 'cannot render a single candle because its time axis has identical anchors' };
  if (!candles.every(isFiniteCandle)) return { ok: false, reason: 'candle time and prices must be finite numbers' };
  if (!candles.every(isValidOhlc)) return { ok: false, reason: 'candle high and low must enclose open and close prices' };
  if (!candles.every((candle, index) => index === 0 || candles[index - 1].time < candle.time)) {
    return { ok: false, reason: 'candle times must be strictly increasing' };
  }

  const padding = resolvePadding(options.padding);
  if (![options.width, options.height, padding.top, padding.right, padding.bottom, padding.left].every(Number.isFinite)) {
    return { ok: false, reason: 'chart dimensions and padding must be finite numbers' };
  }
  if (options.width <= 0 || options.height <= 0 || Object.values(padding).some((value) => value < 0)) {
    return { ok: false, reason: 'chart dimensions must be positive and padding cannot be negative' };
  }

  const plot: ChartPlot = {
    left: padding.left,
    top: padding.top,
    width: options.width - padding.left - padding.right,
    height: options.height - padding.top - padding.bottom,
  };
  if (!isFinitePlot(plot) || plot.width < 1 || plot.height < 1) {
    return { ok: false, reason: 'chart dimensions leave a plot area smaller than one pixel' };
  }

  const candleWidth = plot.width / candles.length;
  if (!Number.isFinite(candleWidth)) return { ok: false, reason: 'candle width calculation is not finite' };
  if (candleWidth < 1) return { ok: false, reason: 'candle width is less than one pixel' };

  const { low, high } = candlePriceExtrema(candles);
  if (low === high) return { ok: false, reason: 'all candle prices are identical' };

  const priceRange = high - low;
  const timeRange = candles[candles.length - 1].time - candles[0].time;
  const pricePadding = priceRange * PRICE_PADDING_RATIO;
  if (![priceRange, timeRange, pricePadding].every(Number.isFinite) || timeRange <= 0 || priceRange <= 0) {
    return { ok: false, reason: 'candle axis range calculation is not finite' };
  }

  const priceAxisLow = low - pricePadding;
  const priceAxisHigh = high + pricePadding;
  if (!(priceAxisLow < low && priceAxisHigh > high)) {
    return { ok: false, reason: 'price range cannot provide strict finite padding' };
  }

  const anchors: ChartAnchors = {
    time: [
      { value: candles[0].time, pixel: plot.left + candleWidth / 2 },
      { value: candles[candles.length - 1].time, pixel: plot.left + plot.width - candleWidth / 2 },
    ],
    price: [
      { value: priceAxisLow, pixel: plot.top + plot.height },
      { value: priceAxisHigh, pixel: plot.top },
    ],
  };
  if (!areFiniteAnchors(anchors)) return { ok: false, reason: 'chart anchor calculation is not finite' };

  const bodyWidth = Math.max(1, candleWidth * 0.7);
  const renderedCandles = candles.map((candle) => ({
    candle,
    x: interpolate(anchors.time[0], anchors.time[1], candle.time),
    openY: interpolate(anchors.price[0], anchors.price[1], candle.open),
    closeY: interpolate(anchors.price[0], anchors.price[1], candle.close),
    highY: interpolate(anchors.price[0], anchors.price[1], candle.high),
    lowY: interpolate(anchors.price[0], anchors.price[1], candle.low),
  }));
  if (!Number.isFinite(bodyWidth) || !renderedCandles.every(hasFiniteCoordinates)) {
    return { ok: false, reason: 'candle coordinate calculation is not finite' };
  }

  const parts = renderedCandles.map(({ candle, x, openY, closeY, highY, lowY }) => {
    const bodyHeight = Math.max(1, Math.abs(openY - closeY));
    const desiredBodyY = openY === closeY ? closeY - 0.5 : Math.min(openY, closeY);
    const bodyY = clamp(desiredBodyY, plot.top, plot.top + plot.height - bodyHeight);
    const color = candle.close > candle.open ? RISING_COLOR : candle.close < candle.open ? FALLING_COLOR : FLAT_COLOR;
    return `<line class="candle-wick" data-time="${candle.time}" x1="${x}" y1="${highY}" x2="${x}" y2="${lowY}" stroke="${color}"/>`
      + `<rect class="candle-body" data-time="${candle.time}" x="${x - bodyWidth / 2}" y="${bodyY}" width="${bodyWidth}" height="${bodyHeight}" fill="${color}"/>`;
  });

  return {
    ok: true,
    svg: `<svg xmlns="${SVG_NAMESPACE}" width="${options.width}" height="${options.height}" viewBox="0 0 ${options.width} ${options.height}">${parts.join('')}</svg>`,
    anchors,
    plot,
  };
}

function isFiniteCandle(candle: Candlestick): boolean {
  return [candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite);
}

function isValidOhlc(candle: Candlestick): boolean {
  return candle.high >= Math.max(candle.open, candle.close) && candle.low <= Math.min(candle.open, candle.close);
}

function candlePriceExtrema(candles: readonly Candlestick[]): { low: number; high: number } {
  let low = candles[0].low;
  let high = candles[0].high;
  for (let index = 1; index < candles.length; index += 1) {
    const candle = candles[index];
    if (candle.low < low) low = candle.low;
    if (candle.high > high) high = candle.high;
  }
  return { low, high };
}

function isFinitePlot(plot: ChartPlot): boolean {
  return [plot.left, plot.top, plot.width, plot.height].every(Number.isFinite);
}

function areFiniteAnchors(anchors: ChartAnchors): boolean {
  return [...anchors.time, ...anchors.price].every((anchor) => Number.isFinite(anchor.value) && Number.isFinite(anchor.pixel));
}

function hasFiniteCoordinates(item: { x: number; openY: number; closeY: number; highY: number; lowY: number }): boolean {
  return [item.x, item.openY, item.closeY, item.highY, item.lowY].every(Number.isFinite);
}

function resolvePadding(padding: CandlestickChartOptions['padding']): Required<ChartPadding> {
  if (typeof padding === 'number') return { top: padding, right: padding, bottom: padding, left: padding };
  return { top: padding?.top ?? 20, right: padding?.right ?? 20, bottom: padding?.bottom ?? 20, left: padding?.left ?? 20 };
}

function interpolate(first: { value: number; pixel: number }, second: { value: number; pixel: number }, value: number): number {
  return first.pixel + ((value - first.value) * (second.pixel - first.pixel)) / (second.value - first.value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
