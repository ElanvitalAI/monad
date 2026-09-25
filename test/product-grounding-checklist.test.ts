/**
 * 🧾 상품 접지 체크리스트 — ⛔ 표본은 «실제 페이지에서 긁은 것»이다(지어낸 것 아님).
 *
 * 📏 2026-09-10 `aside`(사람의 실제 브라우저)로 세 사이트를 «같은 수집기»로 훑어 저장했다.
 *   ⛔ 헤드리스로는 못 얻는다 — firecrawl 은 쿠팡에서 «내비게이션만», 네이버에선 «인스타 릴스»를 냈다.
 *
 * 🔑 이 시험이 무는 것은 「크롤이 되나」가 아니라 ***「체크리스트가 «무엇이 빠졌는지» 이름을 대나」***다.
 *   새 사이트가 오면 여기에 표본을 «한 칸» 더하는 것으로 끝나야 한다 — 코드를 짓는 게 아니라.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateGrounding, detectCategory, formatVerdict, type PageFacts } from '../src/product-grounding/checklist.js';

const FIXTURES = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures', 'grounding-facts-2026-09-10.json'), 'utf8'),
) as Record<string, PageFacts>;

const statusOf = (facts: PageFacts, id: string) =>
  evaluateGrounding(facts).checks.find((c) => c.id === id)?.status;

describe('상품 접지 체크리스트 — 세 사이트 실측 표본', () => {
  test('⛔ 카테고리를 «먼저» 고른다 — 축이 카테고리마다 다르다', () => {
    expect(detectCategory(FIXTURES.coupang.specRows)).toBe('cosmetic');
    expect(detectCategory(FIXTURES.naver.specRows)).toBe('cosmetic');
    // 🔴 무신사는 의류다 — 화장품 축(용량·사용기한)을 대면 «언제나 미통과»가 난다.
    //   그건 페이지 결함이 아니라 «내 자가 틀린 것»이다.
    expect(detectCategory(FIXTURES.musinsa.specRows)).toBe('apparel');
  });

  test('✅ 쿠팡 — 화장품 축 넷 ⊕ 상세 이미지를 «전부» 얻는다', () => {
    const v = evaluateGrounding(FIXTURES.coupang);
    for (const id of ['spec-volume', 'spec-maker', 'spec-origin', 'spec-expiry', 'detail-images']) {
      expect([id, statusOf(FIXTURES.coupang, id)]).toEqual([id, 'ok']);
    }
    expect(v.passed).toBe(true);
  });

  test('🩸 법적 지위는 «값 안»에 있었다 — 키만 뒤지면 「없다」로 읽는다', () => {
    // ⛔ 내가 1차에 틀린 자리. 쿠팡 OBgE 의 기능성 표기는 «별도 키»가 아니라
    //   "…모든 성분" 칸의 «값» 안에 `기능성 화장품 심사(또는 보고)를 필함 해당 유무 유/…` 로 있다.
    const legal = evaluateGrounding(FIXTURES.coupang).checks.find((c) => c.id === 'legal-status');
    expect(legal?.status).toBe('ok');
    expect(legal?.evidence).toContain('값');
    expect(JSON.stringify(legal?.value)).toContain('자외선차단');
  });

  test('⛔ 네이버는 그 칸을 «판매자가 안 채웠다» — `missing` 이지 `unmeasurable` 이 아니다', () => {
    // 📌 「더 크롤하면 나온다」가 참인 칸과 거짓인 칸을 구분한다.
    //   여기선 «판매자가 채우면» 나온다 ⇒ missing.
    expect(statusOf(FIXTURES.naver, 'legal-status')).toBe('missing');
  });

  test('⛔ 의류에는 화장품 축을 «묻지 않는다»', () => {
    const ids = evaluateGrounding(FIXTURES.musinsa).checks.map((c) => c.id);
    expect(ids).not.toContain('spec-volume');
    expect(ids).not.toContain('legal-status');
    expect(ids).toContain('spec-size');
  });

  test('⭐ 펼치기는 «추측하지 않고 잰다» — 사이트마다 답이 다르다', () => {
    const read = (k: string) =>
      evaluateGrounding(FIXTURES[k]).checks.find((c) => c.id === 'expansion-measured')!;
    // 쿠팡·무신사: 클릭해도 이미지가 «안 늘었다» — 컨테이너만 폈다
    expect(read('coupang').evidence).toContain('컨테이너만');
    expect(read('musinsa').evidence).toContain('컨테이너만');
    // 네이버: 클릭이 «필수»다 — 안 누르면 상세 26장(+13,000px)을 잃는다
    expect(read('naver').evidence).toContain('필수');
    expect((read('naver').value as { deltaImages: number }).deltaImages).toBe(26);
  });

  test('🔴 클릭이 «페이지를 떠나면» 그 수집은 무효라고 말한다', () => {
    // 실제로 일어났다 — 무신사에서 「더보기」가 펼치기가 아니라 네비게이션 링크였다.
    const v = evaluateGrounding(FIXTURES['musinsa-navigated-away']);
    expect(statusOf(FIXTURES['musinsa-navigated-away'], 'stayed-on-page')).toBe('missing');
    expect(v.passed).toBe(false);
    expect(formatVerdict(v)).toContain('무효');
  });

  test('⛔ 펼치기를 «안 쟀으면» 통과시키지 않는다', () => {
    const { expansion: _drop, ...noExpansion } = FIXTURES.coupang as PageFacts & { expansion?: unknown };
    expect(statusOf(noExpansion as PageFacts, 'expansion-measured')).toBe('missing');
    expect(evaluateGrounding(noExpansion as PageFacts).passed).toBe(false);
  });

  test('📌 사람 칸은 «이름과 이유»를 함께 낸다 — 「몇 개 실패」로 접지 않는다', () => {
    const v = evaluateGrounding(FIXTURES.naver);
    expect(v.humanSlots.length).toBeGreaterThan(0);
    for (const s of v.humanSlots) {
      expect(s.id).toBeTruthy();
      expect(s.why.length).toBeGreaterThan(10);
    }
  });
});
