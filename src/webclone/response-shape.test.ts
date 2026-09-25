// ── 응답 모양 시험 — ⛔ 「못 쟀음」을 「없음」으로 접지 않는가 ────────────────────
//
// 🩸 계기(2026-09-11): 「RFC 추론이 응답 모양을 못 낸다」고 적을 뻔했는데
//    ***재료가 없어서***였다 — `--bodies` 가 이미 있는데 «내가 안 썼다».

import { describe, expect, test } from 'bun:test';

import {
  compareKeys, formatShape, inferShape, mergeShapes, topKeys,
  MAX_DEPTH, RESPONSE_SHAPE_BLIND_SPOTS,
} from './response-shape.js';

describe('inferShape', () => {
  test('열쇠를 «이름 순»으로 둔다 — 관측 순서로 두면 대조가 흔들린다', () => {
    expect(topKeys(inferShape({ z: 1, a: 2, m: 3 }))).toEqual(['a', 'm', 'z']);
  });
  test('원시 타입을 이름으로 낸다', () => {
    expect(inferShape('x').kind).toBe('string');
    expect(inferShape(3).kind).toBe('number');
    expect(inferShape(true).kind).toBe('boolean');
    expect(inferShape(null).kind).toBe('null');
  });
  test('⛔ 빈 배열은 「원소 없음」이고 모양은 «못 쟀다»', () => {
    const s = inferShape([]);
    expect(s.kind).toBe('array');
    expect(s.sampled).toBe(0);
    expect(s.element?.kind).toBe('unknown');
    expect(formatShape(s).join(' ')).toContain('못 쟀다');
  });
  test('⭐ 원소를 «합친다» — 첫 원소만 보면 「가끔 있는 필드」를 놓친다', () => {
    const s = inferShape([{ a: 1 }, { a: 1, b: 'x' }]);
    expect(topKeys(s.element!)).toEqual(['a', 'b']);
    expect(s.sampled).toBe(2);
  });
  test('⛔ 너무 깊으면 멈춘다 — 값으로 낸다', () => {
    let deep: unknown = 1;
    for (let i = 0; i < MAX_DEPTH + 3; i += 1) deep = { n: deep };
    expect(JSON.stringify(inferShape(deep))).toContain('unknown');
  });
});

describe('mergeShapes', () => {
  test('같은 종류면 열쇠를 «합집합»으로', () => {
    const m = mergeShapes(inferShape({ a: 1 }), inferShape({ b: 2 }));
    expect(topKeys(m)).toEqual(['a', 'b']);
  });
  test('종류가 다르면 «모른다» — 한쪽으로 몰지 않는다', () => {
    expect(mergeShapes(inferShape('x'), inferShape(3)).kind).toBe('unknown');
  });
  test('`unknown` 은 «상대»에게 자리를 내준다', () => {
    expect(mergeShapes({ kind: 'unknown' }, inferShape('x')).kind).toBe('string');
  });
});

describe('compareKeys — ⛔ 세 갈래로 낸다', () => {
  test('찾음·못 봄·여분을 «가른다»', () => {
    const r = compareKeys(['items', 'meta', 'debug'], ['items', 'meta', 'links']);
    expect(r.found).toEqual(['items', 'meta']);
    expect(r.missed).toEqual(['links']);
    expect(r.extra).toEqual(['debug']);
  });
  test('⭐ `extra` 는 「틀림」이 아니다 — 내 «계약»이 덜 적은 것일 수 있다', () => {
    const r = compareKeys(['items', 'meta'], ['items']);
    expect(r.extra).toEqual(['meta']);
    expect(r.missed).toEqual([]);
  });
  test('관측이 비면 전부 «못 봄»이다', () => {
    const r = compareKeys([], ['items', 'meta']);
    expect(r.found).toEqual([]);
    expect(r.missed).toEqual(['items', 'meta']);
  });
});

describe('실물 — bilryo-dongne 목록 응답 (내가 «직접 쓴» 계약)', () => {
  const body = {
    items: [{
      id: 'drill-01', name: '충전 드릴 · 18V', summary: '…', category: '전동공구',
      area: '수유동', pricePerDay: 3000, deposit: 20000, state: '대여 가능',
      lender: '이웃 A', note: '…',
    }],
    meta: { total: 1, page: 1, per_page: 5, per_page_max: 100, per_page_default: 20, categories: ['전동공구'], areas: ['수유동'] },
  };
  test('최상위가 `items` · `meta` 다', () => {
    expect(topKeys(inferShape(body))).toEqual(['items', 'meta']);
  });
  test('`meta` 에 계약이 말한 셋이 «있다»', () => {
    const meta = (inferShape(body).fields ?? []).find(([k]) => k === 'meta')?.[1];
    const r = compareKeys(topKeys(meta!), ['total', 'categories', 'areas']);
    expect(r.missed).toEqual([]);
  });
  test('Item 의 «필드 아홉»을 되찾는다 ⊕ `id` 는 계약에 «안 적혀» 있었다', () => {
    const items = (inferShape(body).fields ?? []).find(([k]) => k === 'items')?.[1];
    const nine = ['name', 'summary', 'category', 'area', 'pricePerDay', 'deposit', 'state', 'lender', 'note'];
    const r = compareKeys(topKeys(items!.element!), nine);
    expect(r.found.length).toBe(9);
    expect(r.missed).toEqual([]);
    expect(r.extra).toEqual(['id']);   // ⭐ 계약 문서가 «덜 적은» 것이다
  });
  test('⛔ 값은 «안 담는다» — 개인정보·검색어가 섞인다', () => {
    expect(formatShape(inferShape(body)).join('\n')).not.toContain('충전 드릴');
  });
  test('⛔ 못 담는 것을 «값»으로 낸다', () => {
    expect(RESPONSE_SHAPE_BLIND_SPOTS.length).toBeGreaterThanOrEqual(4);
    expect(RESPONSE_SHAPE_BLIND_SPOTS.join(' ')).toContain('error-shape');
  });
});

/**
 * ⛔⭐⭐ 오류 응답 «모양» — 2026-09-11 실측으로 blind spot `error-shape` 를 닫았다.
 * 🩸 그 관측까지 «네 판»이 걸렸고 ①②③ 은 전부 «추측»이었다:
 *    ① --bodies 를 안 씀(부분) ② 대기가 짧다(반증) ③ finished 조건이 좁다(반증)
 *    ④ ⭐ 조용한 catch 를 «세게» 하자 원인이 나왔다 — `No data found for resource`.
 *    🔑 세 번 추측하는 동안 자는 «침묵»하고 있었다.
 */
describe('오류 응답 모양 (실물 관측)', () => {
  const ok = { item: { id: 'drill-01', name: 'x' }, _stub: 's', _unmeasured: ['a'] };
  const err = { errors: [{ detail: '그런 물건이 없습니다' }], _stub: 's', _unmeasured: ['a'] };

  test('404 의 최상위에 `errors` 가 «있다»', () => {
    expect(topKeys(inferShape(err))).toContain('errors');
  });
  test('`errors` 원소에 `detail` 이 «있다»', () => {
    const e = (inferShape(err).fields ?? []).find(([k]) => k === 'errors')?.[1];
    expect(topKeys(e!.element!)).toEqual(['detail']);
  });
  test('⛔⭐ 200 과 404 를 «합치면» 거짓 계약이 나온다 — 그래서 상태를 열쇠에 넣는다', () => {
    const merged = mergeShapes(inferShape(ok), inferShape(err));
    // 합치면 「성공 응답에 errors 가 있다」가 된다 — 이것이 «피해야 할» 모양이다
    expect(topKeys(merged)).toContain('errors');
    expect(topKeys(merged)).toContain('item');
    // ⇒ 가르면 각각이 «자기 계약»만 말한다
    expect(topKeys(inferShape(ok))).not.toContain('errors');
    expect(topKeys(inferShape(err))).not.toContain('item');
  });
  test('⛔ 「소비되지 않은 응답」을 못 담는 것으로 «이름을 댄다»', () => {
    expect(RESPONSE_SHAPE_BLIND_SPOTS.join(' ')).toContain('unconsumed-response');
    expect(RESPONSE_SHAPE_BLIND_SPOTS.join(' ')).toContain('No data found');
  });
});
