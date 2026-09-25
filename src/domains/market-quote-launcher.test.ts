// C-②a — omniQuote 런처/라벨 가드.
//
// omniQuote 는 omni-market skill CLI 를 subprocess 로 부른다(단위 테스트로 실행은 어려움·라이브 스모크로
// 검증됨). 이 테스트는 두 회귀를 소스 레벨에서 못박는다: (1) 런처가 `bun`(느린 `npx tsx` 아님·콜드스타트
// 5배), (2) provider 라벨을 JSON `session` 필드로 판별(종전 `[provider]` 브래킷 regex 는 --json 에 없어
// 늘 'eodhd' 오라벨이던 버그). skill CLI stdout JSON 계약(close/previousClose/change_p/high)은 불변.

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(import.meta.dir, 'market-quote.ts'), 'utf-8');

describe('C-②a omniQuote 런처/라벨 가드', () => {
  test('런처는 bun (느린 npx tsx 아님)', () => {
    expect(src).toContain("execFileSync('bun', [OMNI, 'quote'");
    expect(src).not.toContain("execFileSync('npx', ['tsx', OMNI");
  });

  test('provider 는 omni --json provider 필드 우선(+session 폴백·브래킷 regex 폐기)', () => {
    // C-②a2: j.provider(정확·지수 포함) → session 휴리스틱(구버전 폴백) → eodhd.
    expect(src).toContain('j.provider');
    expect(src).toContain('j.session');
    expect(src).toContain("src.includes('toss')");
    expect(src).toContain("src.includes('yahoo')");
    // 종전 브래킷 provider regex 는 제거됨.
    expect(src).not.toContain('/\\[(\\w+)\\]/.exec(out)');
  });

  test('marketQuote 브랜치가 실제 provider 로 source 라벨(하드코딩 eodhd 제거)', () => {
    // index/fx·KR-closed·US-live·US-closed 4 브랜치가 q.provider 사용.
    expect(src).toContain('source: q.provider');
    // 종전 하드코딩 source:'eodhd' 는 omniQuote 브랜치에서 사라짐(toss-direct 브랜치는 별개).
    expect(src).not.toContain("source: (q.provider === 'yahoo' ? 'yahoo' : 'eodhd')");
  });
});
