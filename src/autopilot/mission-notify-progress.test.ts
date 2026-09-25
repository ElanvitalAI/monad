// ── renderProgressBar 단위테스트 — 경량 진행률 바(대표 2026-07-12·omni-crawl 조사 반영). ──
import { describe, it, expect } from 'bun:test';
import { renderProgressBar, phaseProgressHeader, phaseCardFooter } from './mission-notify.js';

describe('renderProgressBar', () => {
  it('0% / 50% / 100% (width 10)', () => {
    expect(renderProgressBar(0)).toBe('░░░░░░░░░░ 0%');
    expect(renderProgressBar(0.5)).toBe('▓▓▓▓▓░░░░░ 50%');
    expect(renderProgressBar(1)).toBe('▓▓▓▓▓▓▓▓▓▓ 100%');
  });
  it('페이즈 2/7 완료 ≈ 29%', () => {
    expect(renderProgressBar(2 / 7)).toContain('29%');
  });
  it('범위 밖 값은 클램프', () => {
    expect(renderProgressBar(-1)).toBe('░░░░░░░░░░ 0%');
    expect(renderProgressBar(5)).toBe('▓▓▓▓▓▓▓▓▓▓ 100%');
  });
  it('커스텀 width', () => {
    expect(renderProgressBar(0.5, 4)).toBe('▓▓░░ 50%');
  });
});

describe('phaseProgressHeader — Layout A(대표 2026-07-16): 첫줄 여정+상태+%, 아크 이름, 암호 id 없음', () => {
  it('첫줄=아크·페이즈 위치+상태+%, 3행=아크 이름(prefix 제거)', () => {
    const h = phaseProgressHeader({
      index: 2, total: 7, status: 'running',
      arcName: '아크 A — 무해한 자율 ACT 가드', arcSeq: '1/4',
    });
    const [line1, bar, arcLine] = h.split('\n');
    // 1행 = 여정(아크 레터·페이즈 순번) + 상태 + %.
    expect(line1).toBe('🔧 아크 A · 페이즈 3/7 · 구현 중 · 29%');
    expect(bar).toContain('29%'); // 진행바
    // 3행 = 아크 이름("아크 A —" prefix 제거) + 아크 순번.
    expect(arcLine).toBe('⬡ 무해한 자율 ACT 가드 (아크 1/4)');
    // 종전 암호 핸들(A1·0a0d·g0, aacta 슬러그)은 노출하지 않는다.
    expect(h).not.toContain('0a0d');
    expect(h).not.toContain('aacta');
  });

  it('done 은 index+1 진행률·✅·완료 라벨', () => {
    const h = phaseProgressHeader({ index: 1, total: 7, status: 'done', arcName: '아크 A — X', arcSeq: '1/4' });
    expect(h).toContain('✅');
    expect(h).toContain('완료');
    expect(h).toContain('29%'); // (1+1)/7
  });

  it('flat(arcSeq 없음) 은 아크 부분 생략', () => {
    const h = phaseProgressHeader({ index: 0, total: 3, status: 'running' });
    expect(h).not.toContain('⬡');
    expect(h).not.toContain('아크');
    expect(h.startsWith('🔧 페이즈 1/3 · 구현 중 · 0%')).toBe(true);
  });
});

describe('phaseCardFooter — 암호 빌드 id 는 카드 하단(내부)만(대표 2026-07-16)', () => {
  it('프로바이더 + 빌드 note 를 ─ footer 로', () => {
    expect(phaseCardFooter('openai-codex:gpt-5.6-sol')).toBe('\n─ ⚙ openai-codex:gpt-5.6-sol');
    expect(phaseCardFooter(undefined, '⚙ gpt-5.6-terra · 시도 1/3 · bld_9c25af4c'))
      .toBe('\n─ ⚙ gpt-5.6-terra · 시도 1/3 · bld_9c25af4c');
  });
  it('둘 다 없으면 빈 문자열', () => {
    expect(phaseCardFooter()).toBe('');
  });
});
