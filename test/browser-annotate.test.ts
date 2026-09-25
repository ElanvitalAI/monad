import { describe, expect, test } from 'bun:test';

import { chartCoordinates } from '../src/browser-annotate/coords.js';
import { createAnnotationLedger, drawExpression, eraseExpression, existsExpression } from '../src/browser-annotate/inject.js';
import { polylineBounds, renderShape, renderAnnotationSvg, SVG_NAMESPACE, ARROW_MARKER_ID } from '../src/browser-annotate/shapes.js';
import { CHART_TTL_SECONDS, DEFAULT_TTL_SECONDS, MAX_TTL_SECONDS, resolveTtl } from '../src/browser-annotate/ttl.js';
import type { CdpTransport } from '../src/browser-cdp/client.js';

describe('browser annotations: pure SVG shapes', () => {
  test('rejects polyline boundaries outside 2 through 24, while accepting both endpoints', () => {
    expect(renderShape({ kind: 'polyline', points: [{ x: 0, y: 0 }] })).toEqual(expect.objectContaining({ ok: false, reason: expect.stringContaining('1') }));
    expect(renderShape({ kind: 'polyline', points: Array.from({ length: 25 }, (_, x) => ({ x, y: x })) })).toEqual(expect.objectContaining({ ok: false, reason: expect.stringContaining('25') }));
    expect(renderShape({ kind: 'polyline', dashed: true, points: [{ x: 0, y: 0 }, { x: 2, y: 3 }] })).toEqual(expect.objectContaining({ ok: true }));
    expect(renderShape({ kind: 'polyline', points: Array.from({ length: 24 }, (_, x) => ({ x, y: x })) })).toEqual(expect.objectContaining({ ok: true }));
  });

  test('renders all shape kinds with defaults, styles, and escaped label content', () => {
    expect(renderShape({ kind: 'line', from: { x: 1, y: 2 }, to: { x: 3, y: 4 }, color: 'blue', strokeWidth: 4, dashed: true })).toEqual({ ok: true, svg: '<line x1="1" y1="2" x2="3" y2="4" stroke="blue" stroke-width="4" stroke-dasharray="6 4"/>' });
    expect(renderShape({ kind: 'arrow', from: { x: 1, y: 2 }, to: { x: 3, y: 4 } })).toEqual(expect.objectContaining({ ok: true, svg: expect.stringContaining('marker-end') }));
    expect(renderShape({ kind: 'label', at: { x: 1, y: 2 }, text: '<safe&>' })).toEqual(expect.objectContaining({ ok: true, svg: expect.stringContaining('&lt;safe&amp;&gt;') }));
    expect(renderShape({ kind: 'box', from: { x: 4, y: 6 }, to: { x: 1, y: 2 }, fill: 'rgba(0,0,0,.1)' })).toEqual(expect.objectContaining({ ok: true, svg: expect.stringContaining('width="3"') }));
    expect(polylineBounds([{ x: 3, y: 5 }, { x: -2, y: 7 }])).toEqual({ left: -2, top: 5, right: 3, bottom: 7, width: 5, height: 2 });
  });
});

describe('browser annotations: TTL and coordinate transforms', () => {
  test('names TTL choices and explicitly clamps requests above the cap', () => {
    expect([DEFAULT_TTL_SECONDS, CHART_TTL_SECONDS, MAX_TTL_SECONDS]).toEqual([30, 180, 900]);
    expect(resolveTtl(901)).toEqual({ seconds: 900, clamped: true });
    expect(resolveTtl()).toEqual({ seconds: 30, clamped: false });
  });

  test('maps linear and logarithmic axes, returning impossible values rather than zero pixels', () => {
    const linear = chartCoordinates({ time: [{ value: 0, pixel: 10 }, { value: 10, pixel: 110 }], price: [{ value: 100, pixel: 200 }, { value: 200, pixel: 100 }] }, { time: 5, price: 150 });
    expect(linear).toEqual({ ok: true, x: 60, y: 150 });
    const logarithmic = chartCoordinates({ time: [{ value: 1, pixel: 0 }, { value: 2, pixel: 100 }], price: [{ value: 10, pixel: 100 }, { value: 100, pixel: 0 }], priceScale: 'log' }, { time: 1.5, price: Math.sqrt(1000) });
    expect(logarithmic).toEqual(expect.objectContaining({ ok: true, x: 50 }));
    if (logarithmic.ok) expect(logarithmic.y).toBeCloseTo(50);
    const impossible = chartCoordinates({ time: [{ value: 1, pixel: 0 }, { value: 1, pixel: 99 }], price: [{ value: 1, pixel: 0 }, { value: 2, pixel: 99 }] }, { time: 1, price: 1 });
    expect(impossible).toEqual(expect.objectContaining({ ok: false }));
    expect(impossible).not.toEqual({ ok: true, x: 0, y: 0 });
  });
});

describe('browser annotations: injectable edge', () => {
  test('builders safely include ids and explicitly replace same-id annotations', () => {
    expect(drawExpression('same-id', '<svg><path/></svg>')).toContain(JSON.stringify('same-id'));
    expect(drawExpression('same-id', '<svg><path/></svg>')).toContain('if (old) old.remove()');
    expect(eraseExpression('same-id')).toContain(JSON.stringify('same-id'));
    expect(existsExpression('same-id')).toContain(JSON.stringify('same-id'));
  });

  test('sends draw, expiry erase, and loss checks through a mock CdpTransport', async () => {
    const sent: Array<{ method: string; params?: Record<string, unknown> }> = [];
    let exists = true;
    const transport: CdpTransport = {
      async send(method, params) {
        sent.push({ method, params });
        const expression = String(params?.expression ?? '');
        if (expression.includes('!== null')) return { result: { value: exists } };
        // ⛔ 목이 «실물과 다른 모양»을 내면 이 시험은 다른 것을 잰다 — 주입은 판정 객체를 낸다.
        if (expression.includes('template.innerHTML')) {
          return { result: { value: { attached: true, verdict: 'ok', ns: 'http://www.w3.org/2000/svg', width: 800, height: 600 } } };
        }
        return { result: { value: true } };
      },
      close() {},
    };
    let current = 1_000;
    const ledger = createAnnotationLedger(transport, { now: () => current });
    await ledger.draw('a', [{ kind: 'line' as const, from: { x: 0, y: 0 }, to: { x: 10, y: 10 } }], 1);
    await ledger.draw('a', [{ kind: 'line' as const, from: { x: 0, y: 0 }, to: { x: 20, y: 20 } }], 1);
    expect(sent.filter((call) => String(call.params?.expression).includes('template.innerHTML'))).toHaveLength(2);
    expect(sent.every((call) => call.method === 'Runtime.evaluate' && call.params?.returnByValue === true)).toBeTrue();

    exists = false;
    await ledger.observe();
    expect(sent.some((call) => String(call.params?.expression).includes('!== null'))).toBeTrue();

    await ledger.draw('expires', [{ kind: 'line' as const, from: { x: 0, y: 0 }, to: { x: 30, y: 30 } }], 1);
    current += 1_000;
    await ledger.observe();
    expect(sent.some((call) => String(call.params?.expression).includes('node.remove()'))).toBeTrue();
  });
});

describe('🩸 「그렸다」와 「보인다」 — ⛔ 42차 라이브 반증이 낳은 갈래', () => {
  test('⭐ 루트가 «SVG» 다 — ⛔ 조각만 내면 HTML 요소로 붙어 0×0 이 된다(실물)', () => {
    const out = renderAnnotationSvg([{ kind: 'polyline', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }]);
    expect(out.ok).toBeTrue();
    if (out.ok) {
      expect(out.svg.startsWith('<svg ')).toBeTrue();
      expect(out.svg).toContain(`xmlns="${SVG_NAMESPACE}"`);
      // ⛔ 루트가 «뷰포트를 채워야» 한다 — 작으면 페이지 좌표로 그린 도형이 잘린다.
      expect(out.svg).toContain('width:100vw');
      expect(out.svg).toContain('pointer-events:none');
      expect(out.svg).toContain('<polyline');
    }
  });

  test('⛔ 화살촉은 `<marker>` 정의가 «없으면» 안 그려진다 — 있을 때만 낸다', () => {
    const withArrow = renderAnnotationSvg([{ kind: 'arrow', from: { x: 0, y: 0 }, to: { x: 9, y: 9 } }]);
    const without = renderAnnotationSvg([{ kind: 'line', from: { x: 0, y: 0 }, to: { x: 9, y: 9 } }]);
    expect(withArrow.ok && withArrow.svg.includes(`<marker id="${ARROW_MARKER_ID}"`)).toBeTrue();
    expect(without.ok && without.svg.includes('<marker')).toBeFalse();
  });

  test('⛔ 한 조각이 거절되면 «전부» 거절한다 — 반쪽 그림은 「보인다」보다 나쁘다', () => {
    const out = renderAnnotationSvg([
      { kind: 'line', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
      { kind: 'polyline', points: [{ x: 0, y: 0 }] },
    ]);
    expect(out.ok).toBeFalse();
    if (!out.ok) expect(out.reason).toContain('2 to 24');
  });

  test('🔑⭐ 주입 표현식이 «되읽어» 판정한다 — 「붙였다」를 「보인다」로 말하지 않는다', () => {
    const expr = drawExpression('probe', '<svg/>');
    expect(expr).toContain('namespaceURI');
    expect(expr).toContain('getBoundingClientRect');
    expect(expr).toContain('wrong-namespace');
    expect(expr).toContain('zero-size');
  });

  test('🔑⭐ 그리고 원장이 그 판정을 «돌려준다» ⊕ 「모르겠다」와 「안 보인다」를 가른다', async () => {
    const shapes = [{ kind: 'line' as const, from: { x: 0, y: 0 }, to: { x: 5, y: 5 } }];
    const make = (value: unknown): CdpTransport => ({
      async send() { return { result: { value } }; }, close() {},
    });
    const good = await createAnnotationLedger(make({ attached: true, verdict: 'ok', width: 100, height: 50 }))
      .draw('x', shapes);
    expect(good.verdict).toBe('ok');
    const zero = await createAnnotationLedger(make({ attached: true, verdict: 'zero-size', width: 0, height: 0 }))
      .draw('x', shapes);
    expect(zero.verdict).toBe('zero-size');
    // ⛔ 저쪽이 «뜻 모를» 값을 주면 「안 보인다」가 아니라 「못 읽었다」다.
    const garbage = await createAnnotationLedger(make(true)).draw('x', shapes);
    expect(garbage.verdict).toBe('unreadable');
  });

  test('🔑⛔ 안 붙은 것은 «원장에 안 넣는다» — 넣으면 observe 가 그것을 `lost` 로 «오인»한다', async () => {
    const shapes = [{ kind: 'line' as const, from: { x: 0, y: 0 }, to: { x: 5, y: 5 } }];
    const seen: string[] = [];
    const transport: CdpTransport = {
      async send(_m, params) {
        const expression = String(params?.expression ?? '');
        seen.push(expression);
        // 주입은 «뜻 모를» 값을 내고(=unreadable), 존재 조회는 「없다」를 낸다.
        if (expression.includes('!== null')) return { result: { value: false } };
        return { result: { value: 'garbage' } };
      },
      close() {},
    };
    const ledger = createAnnotationLedger(transport);
    const out = await ledger.draw('ghost', shapes);
    expect(out.verdict).toBe('unreadable');
    seen.length = 0;
    await ledger.observe();
    // ⛔ 원장이 비어 있어야 한다 ⇒ observe 가 그 id 를 «묻지도 않는다».
    expect(seen.some((expression) => expression.includes('ghost'))).toBeFalse();
  });

  test('⛔ `attached` 가 boolean 이 아니면 «못 읽은 것»이다 — verdict 만 보고 믿지 않는다', async () => {
    const shapes = [{ kind: 'line' as const, from: { x: 0, y: 0 }, to: { x: 5, y: 5 } }];
    const ledger = createAnnotationLedger({
      async send() { return { result: { value: { verdict: 'ok' } } }; }, close() {},
    });
    expect((await ledger.draw('x', shapes)).verdict).toBe('unreadable');
  });

  test('⛔ 그릴 것이 «없으면» 거절한다 — 빈 <svg> 를 붙이지 않는다', async () => {
    const out = await createAnnotationLedger({ async send() { return {}; }, close() {} }).draw('x', []);
    expect(out.verdict).toBe('no-root');
    expect(out.attached).toBeFalse();
  });

  test('🔢⛔ TTL 을 «조용히» 깎지 않는다 — 음수·NaN 도 「깎았다」로 말한다', () => {
    expect(resolveTtl(-5)).toEqual({ seconds: 0, clamped: true });
    expect(resolveTtl(Number.NaN)).toEqual({ seconds: DEFAULT_TTL_SECONDS, clamped: true });
    expect(resolveTtl(CHART_TTL_SECONDS)).toEqual({ seconds: CHART_TTL_SECONDS, clamped: false });
    expect(resolveTtl(MAX_TTL_SECONDS + 1)).toEqual({ seconds: MAX_TTL_SECONDS, clamped: true });
  });

  test('🔢⛔ NaN 좌표는 «거짓 초록»이 아니다 — NaN 은 `a === b` 를 통과한다', () => {
    const anchors = {
      time: [{ value: 0, pixel: 0 }, { value: 10, pixel: 100 }] as const,
      price: [{ value: 0, pixel: 400 }, { value: 10, pixel: 0 }] as const,
    };
    const bad = chartCoordinates(anchors, { time: Number.NaN, price: 5 });
    expect(bad.ok).toBeFalse();
    if (!bad.ok) expect(bad.reason).toContain('finite');
    // 그리고 «정상»은 여전히 정상이다.
    const good = chartCoordinates(anchors, { time: 5, price: 5 });
    expect(good).toEqual({ ok: true, x: 50, y: 200 });
  });
});
