import { describe, it, expect } from 'bun:test';
import { coverageFallback, salientTokens, parseMissingIndices } from './coverage.js';

const CHECKLIST = [
  'claude code 누출 이후 시작 (2026.4)',
  '맥북 M5 MAX 128GB(메인 서버), 맥스튜디오 M3 Ultra 512GB',
  'Grok Heavy 300$',
  '2장의 mermaid 차트 => 기본 구조와 자동 리뷰 시스템',
  '50% 완성 상태 오케스트레이어 조율형 빌드',
];

describe('coverageFallback — 산출물 대조', () => {
  it('담긴 항목은 covered, 빠진 항목은 missing', () => {
    // mermaid·50%·Grok 만 담고 M5 MAX·claude 누출은 뺀 산출물
    const artifact =
      'mermaid 차트 2장으로 기본 구조와 자동 리뷰 시스템을 그렸다. ' +
      '오케스트레이터는 50% 완성 상태이며 Grok Heavy 300 달러 구독을 쓴다.';
    const r = coverageFallback(artifact, CHECKLIST);
    expect(r.missing.join('|')).toContain('claude code 누출');
    expect(r.missing.join('|')).toContain('M5 MAX');
    expect(r.covered.join('|')).toContain('mermaid');
    expect(r.covered.join('|')).toContain('50%');
    expect(r.method).toBe('fallback');
    expect(r.ratio).toBeGreaterThan(0);
    expect(r.ratio).toBeLessThan(1);
  });

  it('전부 담기면 missing 없음·ratio 1', () => {
    const full =
      'claude code 누출 2026.4 시작, 맥북 M5 MAX 128GB 메인 서버, 맥스튜디오 M3 Ultra 512GB, ' +
      'Grok Heavy 300, mermaid 차트 2장 기본 구조 자동 리뷰, 50% 오케스트레이터 조율형 빌드';
    const r = coverageFallback(full, CHECKLIST);
    expect(r.missing).toEqual([]);
    expect(r.ratio).toBe(1);
  });

  it('빈 체크리스트 → ratio 1', () => {
    expect(coverageFallback('아무거나', []).ratio).toBe(1);
  });
});

describe('salientTokens', () => {
  it('변별 토큰 추출(불용어·1자 제외)', () => {
    const t = salientTokens('맥북 M5 MAX 128GB');
    expect(t).toContain('맥북');
    expect(t).toContain('m5');
    expect(t).toContain('128gb');
  });
});

describe('parseMissingIndices', () => {
  it('정상 인덱스 파싱·범위 필터', () => {
    expect(parseMissingIndices('미달: [1,3,5]', 5)).toEqual([1, 3, 5]);
    expect(parseMissingIndices('[1,99,2]', 5)).toEqual([1, 2]); // 99 범위초과 제거
  });
  it('빈 배열(전부 커버)', () => {
    expect(parseMissingIndices('[]', 5)).toEqual([]);
  });
  it('배열 아니면 null(폴백 유도)', () => {
    expect(parseMissingIndices('그냥 텍스트', 5)).toBeNull();
  });
});
