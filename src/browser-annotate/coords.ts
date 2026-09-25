export interface AxisAnchor {
  value: number;
  pixel: number;
}

export interface ChartAnchors {
  time: readonly [AxisAnchor, AxisAnchor];
  price: readonly [AxisAnchor, AxisAnchor];
  priceScale?: 'linear' | 'log';
}

export type CoordinateResult =
  | { ok: true; x: number; y: number }
  | { ok: false; reason: string };

/** Maps chart-domain values through two visible axis anchors into page pixels. */
export function chartCoordinates(
  anchors: ChartAnchors,
  point: { time: number; price: number },
): CoordinateResult {
  const x = interpolate(anchors.time[0], anchors.time[1], point.time);
  if (!x.ok) return { ok: false, reason: `time axis: ${x.reason}` };

  const priceScale = anchors.priceScale ?? 'linear';
  if (priceScale === 'log' && (anchors.price[0].value <= 0 || anchors.price[1].value <= 0 || point.price <= 0)) {
    return { ok: false, reason: 'log price axis requires positive anchor and point values' };
  }
  const priceAnchors: readonly [AxisAnchor, AxisAnchor] = priceScale === 'log'
    ? [{ value: Math.log(anchors.price[0].value), pixel: anchors.price[0].pixel }, { value: Math.log(anchors.price[1].value), pixel: anchors.price[1].pixel }]
    : anchors.price;
  const y = interpolate(priceAnchors[0], priceAnchors[1], priceScale === 'log' ? Math.log(point.price) : point.price);
  if (!y.ok) return { ok: false, reason: `price axis: ${y.reason}` };
  return { ok: true, x: x.pixel, y: y.pixel };
}

function interpolate(first: AxisAnchor, second: AxisAnchor, value: number): { ok: true; pixel: number } | { ok: false; reason: string } {
  // ⛔⭐ NaN 은 `a === b` 를 «통과한다»(NaN !== NaN) ⇒ 첫 판은 `{ok:true, pixel:NaN}` 을 냈다.
  //    그것이 이 축의 「거짓 초록」이다 — 호출자는 `ok:true` 를 보고 NaN 좌표로 그린다.
  //    🔑 「불가능하다」와 「0 픽셀」을 가르는 것이 이 함수의 계약이므로 NaN 도 «불가능» 쪽이다.
  if (![first.value, second.value, first.pixel, second.pixel, value].every(Number.isFinite)) {
    return { ok: false, reason: 'anchor or point value is not a finite number' };
  }
  if (first.value === second.value) return { ok: false, reason: 'anchor values are identical' };
  return { ok: true, pixel: first.pixel + ((value - first.value) * (second.pixel - first.pixel)) / (second.value - first.value) };
}
