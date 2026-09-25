// Self-Evolution SE0 문서 인벤토리/맵 단위테스트 — 순수 분류(무네트워크).
import { describe, test, expect } from 'bun:test';
import {
  prefixOf, dateOf, topicOf, countBoxes, staleScore, kindOfPrefix, parseIndexLinks, indexGaps, type DocEntry,
} from './doc-inventory.js';
import { buildDocMap } from './doc-map.js';

describe('prefixOf / dateOf / topicOf', () => {
  test('prefix 추출', () => {
    expect(prefixOf('PLAN-autopilot-2026-07-08.md')).toBe('PLAN');
    expect(prefixOf('ROADMAP-self-evolution-2026-07-09.md')).toBe('ROADMAP');
    expect(prefixOf('random-notes.md')).toBe('OTHER');
  });
  test('date 추출(마지막)', () => {
    expect(dateOf('HANDOFF-x-2026-07-09.md')).toBe('2026-07-09');
    expect(dateOf('PLAN-regime-2026-07-07-v2.md')).toBe('2026-07-07');
    expect(dateOf('MANUAL-debug.md')).toBeNull();
  });
  test('topic 슬러그(prefix·date 제거)', () => {
    expect(topicOf('PLAN-autopilot-2026-07-08.md')).toBe('autopilot');
    expect(topicOf('RESEARCH-self-evolution-2026-07-09.md')).toBe('self-evolution');
    expect(topicOf('PLAN-h6-p6-capture-source-registry-mini.md')).toContain('capture-source-registry');
  });
});

describe('countBoxes', () => {
  test('미완/완료 카운트', () => {
    const md = '- [ ] a\n- [x] b\n  - [ ] c\n* [X] d\n일반 텍스트';
    const r = countBoxes(md);
    expect(r.open).toBe(2);
    expect(r.done).toBe(2);
  });
});

describe('kindOfPrefix', () => {
  test('성격 매핑', () => {
    expect(kindOfPrefix('PLAN')).toBe('plan');
    expect(kindOfPrefix('ROADMAP')).toBe('roadmap');
    expect(kindOfPrefix('HANDOFF')).toBe('handoff');
    expect(kindOfPrefix('RECAP')).toBe('recap');
    expect(kindOfPrefix('CAPABILITIES')).toBe('reference');
    expect(kindOfPrefix('ZZZ')).toBe('other');
  });
});

describe('staleScore', () => {
  const now = Date.parse('2026-07-09');
  test('오래되고 미완 많으면 높음', () => {
    const old = staleScore({ date: '2026-04-01', openBoxes: 20, doneBoxes: 0, prefix: 'PLAN' }, now);
    const fresh = staleScore({ date: '2026-07-08', openBoxes: 0, doneBoxes: 10, prefix: 'PLAN' }, now);
    expect(old).toBeGreaterThan(fresh);
    expect(old).toBeGreaterThan(45);
  });
  test('handoff/recap 는 이력 가산', () => {
    const h = staleScore({ date: '2026-07-08', openBoxes: 0, doneBoxes: 0, prefix: 'HANDOFF' }, now);
    expect(h).toBeGreaterThanOrEqual(20);
  });
});

describe('buildDocMap', () => {
  const now = Date.parse('2026-07-09');
  const E = (over: Partial<DocEntry>): DocEntry => ({
    path: 'docs/x.md', filename: 'x.md', prefix: 'PLAN', topic: 't', date: '2026-07-01',
    sizeBytes: 2048, openBoxes: 0, doneBoxes: 0, subdir: '', ...over,
  });
  test('성격별·미구현·정리 섹션 포함', () => {
    const entries = [
      E({ filename: 'PLAN-a-2026-04-01.md', prefix: 'PLAN', topic: 'a', date: '2026-04-01', openBoxes: 20 }),
      E({ filename: 'ROADMAP-b-2026-07-08.md', prefix: 'ROADMAP', topic: 'b', date: '2026-07-08', openBoxes: 5, doneBoxes: 5 }),
      E({ filename: 'HANDOFF-c-2026-07-09.md', prefix: 'HANDOFF', topic: 'c', date: '2026-07-09' }),
      E({ filename: 'RESEARCH-a-2026-04-02.md', prefix: 'RESEARCH', topic: 'a', date: '2026-04-02' }),
      E({ filename: 'PLAN-a-2026-05-02.md', prefix: 'PLAN', topic: 'a', date: '2026-05-02' }),
    ];
    const md = buildDocMap(entries, { nowMs: now, totalAllMd: 1734 });
    expect(md).toContain('문서 종합맵');
    expect(md).toContain('## 1. 성격별 분포');
    expect(md).toContain('## 3. 미구현 로드맵');
    expect(md).toContain('PLAN-a-2026-04-01.md'); // 미완 20 → 미구현 섹션
    expect(md).toContain('## 4. 정리 후보');
    expect(md).toContain('## 6. 정리 권고');
    expect(md).toContain('1734');
  });
});

describe('parseIndexLinks', () => {
  test('markdown 링크 타깃 추출·정규화(앵커·./ 제거)', () => {
    const idx = [
      '| x | [`HANDOFF-a.md`](HANDOFF-a.md) |',
      '- [`FEATURE-b`](feature/FEATURE-b-2026-07-09.md) 설명',
      '[link](./manual/MANUAL-c.md#section) 앵커',
      '외부 [http](https://x.com/y.md) 은 포함되도 무해',
    ].join('\n');
    const links = parseIndexLinks(idx);
    expect(links.has('HANDOFF-a.md')).toBe(true);
    expect(links.has('feature/FEATURE-b-2026-07-09.md')).toBe(true);
    expect(links.has('manual/MANUAL-c.md')).toBe(true); // 앵커 스트립
  });

  test('위키 링크 뒤 괄호 설명은 Markdown 주소로 추출하지 않는다', () => {
    const links = parseIndexLinks('[[MANUAL-goal-authoring-method-2026-08-03]](v29)');
    expect(links.refs).toEqual([{ target: 'MANUAL-goal-authoring-method-2026-08-03', syntax: 'wiki' }]);
  });

  test('중첩 대괄호를 가진 Markdown 링크는 계속 추출한다', () => {
    const links = parseIndexLinks('[label [nested]](manual/MANUAL-c.md)');
    expect(links.refs).toEqual([{ target: 'manual/MANUAL-c.md', syntax: 'markdown' }]);
  });
});

describe('indexGaps — trailhead 미등록 최근 문서', () => {
  const E = (over: Partial<DocEntry>): DocEntry => ({
    path: 'docs/x.md', filename: 'x.md', prefix: 'PLAN', topic: 't', date: '2026-07-09',
    sizeBytes: 2048, openBoxes: 0, doneBoxes: 0, subdir: '', ...over,
  });
  test('등록 안 됨 + trailhead prefix + 최근 = 갭', () => {
    const entries = [
      E({ path: 'docs/feature/FEATURE-REPORT-new-2026-07-09.md', filename: 'FEATURE-REPORT-new-2026-07-09.md', prefix: 'FEATURE', date: '2026-07-09' }),
      E({ path: 'docs/HANDOFF-registered-2026-07-09.md', filename: 'HANDOFF-registered-2026-07-09.md', prefix: 'HANDOFF', date: '2026-07-09' }),
      E({ path: 'docs/PLAN-old-2026-05-01.md', filename: 'PLAN-old-2026-05-01.md', prefix: 'PLAN', date: '2026-05-01' }), // 오래됨 제외
      E({ path: 'docs/manual/MANUAL-x.md', filename: 'MANUAL-x.md', prefix: 'MANUAL', date: null }), // trailhead prefix 아님
    ];
    const linked = new Set(['HANDOFF-registered-2026-07-09.md']);
    const gaps = indexGaps(entries, linked, { sinceDate: '2026-07-08' });
    expect(gaps.map(g => g.path)).toEqual(['docs/feature/FEATURE-REPORT-new-2026-07-09.md'.replace(/^docs\//, '')]);
    expect(gaps.length).toBe(1);
    expect(gaps[0]!.prefix).toBe('FEATURE');
  });
  test('buildDocMap §7 — indexLinks 주면 갭 섹션 렌더', () => {
    const entries = [E({ path: 'docs/feature/FEATURE-REPORT-gap-2026-07-09.md', filename: 'FEATURE-REPORT-gap-2026-07-09.md', prefix: 'FEATURE', date: '2026-07-09' })];
    const md = buildDocMap(entries, { nowMs: Date.parse('2026-07-10'), indexLinks: new Set(), gapSinceDate: '2026-07-01' });
    expect(md).toContain('## 7. trailhead 미등록 최근 문서');
    expect(md).toContain('feature/FEATURE-REPORT-gap-2026-07-09.md');
  });
});
