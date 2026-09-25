/**
 * ⛔⭐ 이 시험은 ***수를 박지 않는다.***
 *
 * 🩸 2026-09-23 🅢 보고: 자기 시험이 한 파일에서 ***네 번*** 「고치는 일」을 벌했다 —
 *   `toHaveLength(16)` 같은 «현재 상태»를 박아 두었기 때문이다.
 *   > ***래칫과 다르다.*** 래칫은 「지금보다 **나빠지면**」 빨강이고,
 *   > 이건 「지금과 **달라지면**」 빨강이다. **뒤의 것은 개선도 막는다.**
 *
 * ⇒ 그래서 여기서는 ***파일이 «자기 선언»과 어긋나는가***만 묻는다.
 *   코퍼스가 갱신돼 38 → 42 가 되면 `terms_total` 과 항목을 «같이» 고치면 되고 시험은 통과한다.
 *   ⛔ 한쪽만 고치면 빨강이다 — 그것이 이 시험이 막으려는 «유일한» 것이다.
 */
import { describe, expect, it } from 'bun:test';
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, '..', 'graphs', 'video', 'reference', 'vflow-taxonomy.yaml');

interface Taxonomy {
  terms_total: number;
  corpus: number;
  axes: Record<string, { term: string; n: number }[]>;
  models: { id: string; prompts: number }[];
  record_schema: Record<string, string>;
}

describe('vflow 분류축 — 자기 선언과 어긋나지 않는다', () => {
  const t = parse(readFileSync(FILE, 'utf8')) as Taxonomy;

  it('⛔ 항목 합계가 terms_total 과 «같다» — 한쪽만 고치면 빨강', () => {
    const sum = Object.values(t.axes).reduce((a, v) => a + v.length, 0);
    expect(sum).toBe(t.terms_total);
  });

  it('⛔ 축마다 «비어 있지 않고» 항목마다 term·n 을 갖는다', () => {
    expect(Object.keys(t.axes).length).toBeGreaterThan(0);
    for (const [axis, items] of Object.entries(t.axes)) {
      expect(items.length, `${axis} 가 비었다`).toBeGreaterThan(0);
      for (const i of items) {
        expect(typeof i.term, `${axis} 의 term 이 문자열이 아니다`).toBe('string');
        expect(i.n, `${axis}/${i.term} 의 n 이 양수가 아니다`).toBeGreaterThan(0);
      }
    }
  });

  it('⛔ 축이 «빈도순»이다 — 순서가 뒤집히면 「상위」를 읽는 소비자가 틀린다', () => {
    for (const [axis, items] of Object.entries(t.axes)) {
      const ns = items.map((i) => i.n);
      expect([...ns].sort((a, b) => b - a), `${axis} 가 내림차순이 아니다`).toEqual(ns);
    }
  });

  it('⭐ 이 저장소가 «실제로 쓰는» 축이 살아 있다 — 없으면 소비자가 조용히 빈손이 된다', () => {
    // deliver/reframe 이 읽을 비율 · align 이 읽을 길이 — 둘은 이 파이프라인의 «결정 축»이다
    expect(Object.keys(t.axes)).toContain('aspect_ratio');
    expect(Object.keys(t.axes)).toContain('duration');
    expect(t.axes.aspect_ratio!.map((i) => i.term)).toContain('9:16');   // 쇼츠·릴스
  });

  it('⛔ 귀속 칸이 스키마에 «있다» — 원저작자를 떼고 쓰면 안 된다', () => {
    for (const k of ['author', 'authorUrl', 'sourcePost']) {
      expect(Object.keys(t.record_schema), `${k} 가 스키마에 없다`).toContain(k);
    }
  });
});
