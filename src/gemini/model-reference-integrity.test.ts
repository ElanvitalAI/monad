// 카탈로그 ↔ 소비처 «정합» 자 (2026-08-18).
//
// ⛔ 무엇을 푸는가 — 2026-08-18 실측: 라우터·별칭·provider 기본값이 카탈로그에 «없는»
//   모델 id 를 가리키고 있었다(`gemini-3-flash` · `gemini-3-pro`). 그 경로를 타면
//   존재하지 않는 모델을 부른다. 아무도 그것을 «세고 있지 않았다».
//
// ⭐ 이 자는 「어느 모델이 옳은가」를 판정하지 않는다 — 그건 늙는다.
//   ***「소비처가 가리키는 id 가 카탈로그에 있는가」***만 본다. 그 성질은 안 늙는다.
//
// 📏 같은 형태의 선례: models.ts 의 grok 주석 —
//   "'grok-4-1-fast' 는 200 OK 로 응답하지만 실제로는 grok-4.3 이 도는 레거시 별칭이었다".
//   ⇒ 「응답이 온다」와 「그 모델이 돈다」는 다른 값이다. 이 자는 그 앞단(등재 여부)을 막는다.

import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GEMINI_MODELS } from './models.js';
import { PROVIDER_DEFAULT_MODEL } from '../user-config.js';

const REPO_ROOT = join(import.meta.dir, '..', '..');

/** 카탈로그가 아는 id. ⛔ 하드코딩하지 않는다 — 카탈로그를 «읽는다». */
const CATALOG_IDS = new Set(GEMINI_MODELS.map(m => m.id));

/** 소비처 파일에서 `'gemini-<숫자>…'` 꼴 리터럴을 긁는다.
 *  ⛔ 정규식이 놓칠 수 있다 — 그래서 이 자는 「전수」를 주장하지 않고 「이 파일들에서」만 말한다. */
function geminiModelLiterals(relativePath: string): string[] {
  const text = readFileSync(join(REPO_ROOT, relativePath), 'utf8');
  return [...text.matchAll(/'(gemini-\d[^']*)'/g)].map(m => m[1]!);
}

const CONSUMERS = [
  'src/llm/mission-router.ts',
  'src/intelligence-map/model-alias.ts',
];

describe('gemini 모델 참조 정합 — 소비처가 «없는» id 를 가리키지 않는다', () => {
  it('카탈로그가 비어 있지 않다 (분모 확인 — 0이면 이 자는 아무것도 못 잡는다)', () => {
    expect(CATALOG_IDS.size).toBeGreaterThan(0);
  });

  for (const file of CONSUMERS) {
    it(`${file} 의 모든 gemini 모델 리터럴이 카탈로그에 있다`, () => {
      const literals = geminiModelLiterals(file);
      // 분모가 0이면 「위반 0」이 통과가 아니다 — 그 사실을 드러낸다.
      expect(literals.length).toBeGreaterThan(0);
      const missing = [...new Set(literals)].filter(id => !CATALOG_IDS.has(id));
      expect(missing).toEqual([]);
    });
  }

  it('PROVIDER_DEFAULT_MODEL.gemini 가 카탈로그에 있다', () => {
    expect(CATALOG_IDS.has(PROVIDER_DEFAULT_MODEL.gemini)).toBe(true);
  });

  it('⭐ provider 기본값이 카탈로그의 recommended 와 «같다»', () => {
    // ⛔ 「3.7 flash 여야 한다」로 박지 않는다 — 그 이름은 늙는다.
    //   카탈로그가 recommended 로 «표시한 것»과 기본값이 갈리지 않는지만 본다.
    const recommended = GEMINI_MODELS.find(m => m.recommended);
    expect(recommended).toBeDefined();
    expect(PROVIDER_DEFAULT_MODEL.gemini).toBe(recommended!.id);
  });
});
