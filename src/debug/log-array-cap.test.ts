import { describe, expect, it } from 'bun:test';
import { compactForLog } from './log.js';

/** 📏 7일 표본에서 관측된 «진짜» 최대 배열 길이. 기본 상한은 이것보다 넉넉해야 한다. */
const LARGEST_OBSERVED_TRUE_LENGTH = 56;

function moreMarker(value: unknown[]): number | null {
  const last = value.at(-1);
  return last && typeof last === 'object' && '_more' in last ? (last as { _more: number })._more : null;
}

describe('compactForLog 의 기본 배열 상한', () => {
  // ⛔⭐ 6 이었을 때 7일 표본에서 1202개가 사라졌고, 「상한에 닿은」 관측의 48.1%가 데이터를 잃었다.
  //   그중엔 게이트 자신의 관측(importerTestsNotRun)도 있었다.
  it('현행 페이로드를 «안 자른다» — 관측된 최대 실제 길이보다 넉넉하다', () => {
    const payload = { files: Array.from({ length: LARGEST_OBSERVED_TRUE_LENGTH }, (_, index) => `f${index}.ts`) };
    const compacted = compactForLog(payload);
    expect(compacted.files).toHaveLength(LARGEST_OBSERVED_TRUE_LENGTH);
    expect(moreMarker(compacted.files)).toBeNull();
  });

  // ⛔⭐⭐ 🅣 권고 — ***∞ 가 아니라 «큰 유한값»***이어야 한다.
  //   무한으로 두면 「이 배열이 폭주했다」를 ***다음 사람이 «잴 수» 없다***.
  it('그래도 «유한»하다 — 폭주하는 배열은 여전히 「잘렸다」고 말한다', () => {
    const compacted = compactForLog({ files: Array.from({ length: 5000 }, (_, index) => index) });
    const dropped = moreMarker(compacted.files);
    expect(dropped).not.toBeNull();
    expect(dropped!).toBeGreaterThan(0);
    // 진짜 개수 = 남은 것 - 1(마커) + _more  ⇒ 복원 가능해야 한다
    expect(compacted.files.length - 1 + dropped!).toBe(5000);
  });

  // ⛔ 호출부가 명시 한도를 주면 그것이 이긴다 — 저빈도 이벤트가 «전량»을 남기는 관.
  it('호출부의 명시 한도가 기본을 이긴다', () => {
    const compacted = compactForLog({ files: Array.from({ length: 20 }, (_, index) => index) }, { arrayMax: 5 });
    expect(moreMarker(compacted.files)).toBe(15);
  });

  // ⛔ 문자열 상한은 «다른 손잡이»다 — 비용이 7.5배라 이 착지에서 «안 건드렸다».
  it('문자열 상한은 안 건드렸다 — 다른 손잡이이고 비용이 7.5배다', () => {
    const compacted = compactForLog({ text: 'x'.repeat(1000) });
    expect(compacted.text.length).toBeLessThan(1000);
  });
});
