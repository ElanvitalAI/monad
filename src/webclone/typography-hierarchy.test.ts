/**
 * typography-hierarchy.test.ts — ⛔ ***재고 «말할» 뿐 «보정하지 않는다»***.
 *
 * 📏 계기: 52차 실측표의 «첫 줄» — `h2 13px < body 16px < h3 19px`. 불가능한 위계다.
 *    원인은 `querySelector` 가 «문서 첫 번째»를 잡는 것(좌측 네비 라벨이 h2 가 된다).
 * ⛔ 이 자가 값을 «고치면» 그럴듯한 표가 나오고, 보는 사람은 씨앗이 틀렸다는 것을 영영 못 본다.
 */
import { describe, expect, test } from 'bun:test';

import { analyseTypographyHierarchy } from './computed-tokens.js';
import { renderDesignMd } from './design-md.js';

const roles = (sizes: Record<string, string | undefined>) =>
  Object.fromEntries(
    Object.entries(sizes)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, { 'font-size': v as string }]),
  );

describe('불가능한 위계를 «신고»한다', () => {
  test('52차가 실측한 그 표 — h2 가 body 보다 작고 h3 가 h2 보다 크다', () => {
    const w = analyseTypographyHierarchy(roles({ body: '16px', h2: '13px', h3: '19px' }));
    expect(w).toEqual([
      { role: 'h2', violation: 'not-larger-than-body' },
      { role: 'h3', violation: 'not-smaller-than-previous-heading' },
    ]);
  });

  test('정상 위계는 «조용하다»', () => {
    expect(analyseTypographyHierarchy(roles({ body: '16px', h1: '32px', h2: '24px', h3: '20px' }))).toEqual([]);
  });

  test('body 와 «같은» 크기도 위반이다 (제목이 본문과 같으면 위계가 없다)', () => {
    expect(analyseTypographyHierarchy(roles({ body: '16px', h2: '16px' })))
      .toEqual([{ role: 'h2', violation: 'not-larger-than-body' }]);
  });
});

describe('⛔ 「못 읽었다」를 「위반」으로도 「통과」로도 세지 않는다', () => {
  test('크기를 못 읽은 역할은 «건너뛴다»', () => {
    expect(analyseTypographyHierarchy(roles({ body: '16px', h1: undefined, h2: '24px' }))).toEqual([]);
  });

  test('body 를 못 읽으면 「body 보다 작다」를 «판정하지 않는다» — 제목끼리는 여전히 본다', () => {
    const w = analyseTypographyHierarchy(roles({ h1: '20px', h2: '24px' }));
    expect(w).toEqual([{ role: 'h2', violation: 'not-smaller-than-previous-heading' }]);
  });

  test('px 가 아닌 값(못 읽음)도 «건너뛴다» — 0 으로 안 읽는다', () => {
    expect(analyseTypographyHierarchy(roles({ body: '16px', h2: 'inherit' }))).toEqual([]);
  });

  test('표가 «비면» 위반 0 이다 (없는 것을 지어내지 않는다)', () => {
    expect(analyseTypographyHierarchy({})).toEqual([]);
  });
});

describe('⭐ DESIGN.md 에 «닿는가» — 있다 ≠ 닿는다', () => {
  // ⛔ `renderDesignMd` 는 «input.tokens» 를 읽는다 — 겉의 칸이 아니라. 그래서 스텁을 온전히 준다.
  const roleTable = { body: { 'font-size': '16px' }, h1: { 'font-size': '32px' }, h2: { 'font-size': '13px' } };
  const md = (warnings: ReturnType<typeof analyseTypographyHierarchy>) =>
    renderDesignMd({
      tokens: {
        url: 'https://x.test/', viewport: { w: 1280, h: 900 },
        customProperties: { '--ink': '#111111' }, roles: roleTable, diagnostics: {}, missing: [],
        paintedColors: null, typographyWarnings: warnings,
        transitions: { status: 'none', elementCount: 0, durations: [], easings: [], properties: [], limitation: '' },
        honoursReducedMotion: null, browserForcedReducedMotion: false,
      } as never,
      title: 't',
      customProperties: { '--ink': '#111111' },
      roles: roleTable as never,
      paintedColors: null,
      typographyWarnings: warnings,
      assets: [],
    });

  test('위반이 있으면 «표 앞»에 경고가 온다 — 표를 먼저 읽으면 그 수를 믿는다', () => {
    const text = md([{ role: 'h2', violation: 'not-larger-than-body' }]);
    const warnAt = text.indexOf('시각 «크기»를 따라가지 않는다');
    const tableAt = text.indexOf('### 측정된 역할');
    expect(warnAt).toBeGreaterThan(-1);
    if (tableAt > -1) expect(warnAt).toBeLessThan(tableAt);
  });

  test('경고문이 «보정하지 않는다»고 말한다', () => {
    expect(md([{ role: 'h2', violation: 'not-larger-than-body' }])).toContain('보정하지 않는다');
  });

  // ⛔⭐⭐ 이 시험이 «뒤집혔다»(2026-09-10) — 옛 판은 원인을 `querySelector` 라고 «단정»했다.
  //   📏 열 대상 전수: 선택을 「가장 흔한 모양」으로 고쳐도 **6/10 이 그대로**였다.
  //   🔑 ⇒ 원인은 선택이 아니라 ***경고의 «전제»***였다 — DOM 제목 단계는 시각 크기를 안 따라간다.
  //   ⇒ 이제 경고는 원인을 «단정하지 않고» 다시 지을 때 볼 곳(활자 눈금)을 가리킨다.
  test('⛔ 원인을 «단정하지 않는다» — 다시 지을 때 볼 곳을 가리킨다', () => {
    const text = md([{ role: 'h2', violation: 'not-larger-than-body' }]);
    expect(text).not.toContain('querySelector');
    expect(text).toContain('활자 눈금');
    expect(text).toContain('태그 순서');
  });

  test('위반이 «없으면» 경고 블록이 아예 없다 (소음 금지)', () => {
    expect(md([])).not.toContain('따라가지 않는다');
  });
});

// ⛔⭐ 🩸 2026-09-11 — ***이 자가 상용 레퍼런스 «6개 중 5개»를 「불가능한 위계」라 말했다.***
//    ⇒ 「만점을 아는 대상」에 대 보니 «자가» 틀렸다. 표본을 시험에 «실측으로» 박는다.
describe('활자 위계 — 굵기를 «같이» 본다 (2026-09-11 실측 8 레퍼런스 ⊕ 13 자작)', () => {
  const role = (size: string, weight: string) => ({ 'font-size': size, 'font-weight': weight });

  test('⭐ airbnb 실측 — body 14px/400 · h3 14px/500 은 «위반이 아니다»', () => {
    expect(analyseTypographyHierarchy({
      body: role('14px', '400'), h1: role('28px', '700'), h2: role('22px', '600'), h3: role('14px', '500'),
    })).toEqual([]);
  });

  test('⭐ youtube 실측 — body 16px/400 · h3 16px/500 도 «위반이 아니다»', () => {
    expect(analyseTypographyHierarchy({
      body: role('16px', '400'), h1: role('140px', '700'), h2: role('100px', '700'), h3: role('16px', '500'),
    })).toEqual([]);
  });

  test('⛔ 크기가 같고 «굵기도 같으면» 여전히 위반이다 — 화면에서 안 갈린다', () => {
    const w = analyseTypographyHierarchy({ body: role('16px', '400'), h3: role('16px', '400') });
    expect(w).toEqual([{ role: 'h3', violation: 'not-larger-than-body' }]);
  });

  test('⛔ 크기가 «더 작으면» 굵어도 면제하지 않는다 — 21 표본에 그런 제목이 «하나도 없다»', () => {
    const w = analyseTypographyHierarchy({ body: role('16px', '400'), h3: role('13px', '700') });
    expect(w).toEqual([{ role: 'h3', violation: 'not-larger-than-body' }]);
  });

  test('⛔ 굵기를 «못 읽으면» 면제하지 않는다 — 못 쟀음을 「통과」로 접지 않는다', () => {
    const w = analyseTypographyHierarchy({ body: role('16px', '400'), h3: { 'font-size': '16px' } });
    expect(w).toEqual([{ role: 'h3', violation: 'not-larger-than-body' }]);
    // body 굵기를 못 읽어도 마찬가지다.
    expect(analyseTypographyHierarchy({ body: { 'font-size': '16px' }, h3: role('16px', '700') }))
      .toEqual([{ role: 'h3', violation: 'not-larger-than-body' }]);
  });

  test('⭐ 내 사이트 둘(bilryo-dongne 600/400 · dongne-hanbaqui 500/400)도 면제된다', () => {
    expect(analyseTypographyHierarchy({ body: role('16px', '400'), h1: role('24px', '700'), h2: role('20px', '600'), h3: role('16px', '600') })).toEqual([]);
    expect(analyseTypographyHierarchy({ body: role('16px', '400'), h1: role('48px', '700'), h2: role('24px', '600'), h3: role('16px', '500') })).toEqual([]);
  });

  test('⛔ `normal`·`bold` 문자열도 «수»로 읽는다', () => {
    expect(analyseTypographyHierarchy({ body: role('16px', 'normal'), h3: role('16px', 'bold') })).toEqual([]);
  });
})

// ⛔⭐ 「본문 대비」에서 받아들인 원리의 «대칭» — 위계는 크기 «또는» 굵기로 선다.
//    📏 실측(레퍼런스 8 · 2026-09-11): 제목끼리 경고 3건 중 «1건»만 면제된다. 자작 13개엔 영향 0.
describe('제목끼리 위계 — 크기가 같아도 «더 가벼우면» 선다', () => {
  const role = (size: string, weight: string) => ({ 'font-size': size, 'font-weight': weight });

  test('⭐ 실측 netflix — h2 24px/500 → h3 24px/400 은 «위반이 아니다»', () => {
    expect(analyseTypographyHierarchy({
      body: role('16px', '400'), h1: role('56px', '700'), h2: role('24px', '500'), h3: role('24px', '400'),
    })).toEqual([]);
  });

  test('⛔ 실측 starbucks — h1 16/700 → h2 16/700 은 «유지»된다(굵기도 같다)', () => {
    const w = analyseTypographyHierarchy({ body: role('14px', '400'), h1: role('16px', '700'), h2: role('16px', '700') });
    expect(w.map((x) => x.violation)).toContain('not-smaller-than-previous-heading');
  });

  test('⛔ 실측 spotify — h1 16/700 → h2 24/700 은 «유지»된다(오히려 더 크다)', () => {
    const w = analyseTypographyHierarchy({ body: role('14px', '400'), h1: role('16px', '700'), h2: role('24px', '700') });
    expect(w.map((x) => x.violation)).toContain('not-smaller-than-previous-heading');
  });

  test('⛔ 굵기를 «못 읽으면» 면제하지 않는다 — 못 쟀음을 「통과」로 접지 않는다', () => {
    const w = analyseTypographyHierarchy({ body: role('14px', '400'), h1: role('24px', '700'), h2: { 'font-size': '24px' } });
    expect(w.map((x) => x.violation)).toContain('not-smaller-than-previous-heading');
  });

  test('크기가 «더 작으면» 굵기와 무관하게 정상이다', () => {
    expect(analyseTypographyHierarchy({
      body: role('16px', '400'), h1: role('56px', '700'), h2: role('32px', '900'), h3: role('20px', '900'),
    })).toEqual([]);
  });
})
