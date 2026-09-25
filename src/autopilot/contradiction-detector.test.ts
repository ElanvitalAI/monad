// ── contradiction-detector 단위테스트 — 게이트 입력↔판정 모순(시스템 의심) ──
import { describe, it, expect } from 'bun:test';
import { detectContradictions, hasSystemSuspect, renderSystemSuspect } from './contradiction-detector.js';

describe('contradiction-detector — 시스템 의심 진입점(R2)', () => {
  it('변경 파일 있는데 diff 본문 빈 → files-touched-but-empty-diff (price-guard 페이즈0 회귀)', () => {
    const g = { changedFiles: ['docs/SPIKE.md'], diffBody: '' };
    expect(detectContradictions(g).map((s) => s.kind)).toContain('files-touched-but-empty-diff');
    expect(hasSystemSuspect(g)).toBe(true);
  });

  it('변경 파일 + diff 본문 있음 → 모순 없음(정상 built)', () => {
    expect(hasSystemSuspect({ changedFiles: ['a.ts'], diffBody: 'diff --git a/a.ts...' })).toBe(false);
  });

  it('무결성 통과인데 비평 FAIL → tests-pass-but-critique-fail', () => {
    expect(detectContradictions({ testsPassed: true, critiqueVerdict: 'fail' }).map((s) => s.kind))
      .toContain('tests-pass-but-critique-fail');
  });

  it('비평 사유 "실제 diff 본문이 없어" + 변경 인지 → diff-body-absent (실 로그 문구 회귀)', () => {
    const g = { changedFiles: ['x.md'], failText: '실제 diff 본문이 없어 acceptance 충족 여부를 검증할 수 없습니다.' };
    expect(detectContradictions(g).map((s) => s.kind)).toContain('diff-body-absent');
  });

  it('모순 없으면 빈 배열 + renderSystemSuspect 빈 문자열', () => {
    expect(detectContradictions({ changedFiles: ['a.ts'], diffBody: 'x' })).toEqual([]);
    expect(renderSystemSuspect({ changedFiles: ['a.ts'], diffBody: 'x' })).toBe('');
  });

  it('renderSystemSuspect — 모순 있으면 "시스템 결함 의심" 요약', () => {
    expect(renderSystemSuspect({ changedFiles: ['a'], diffBody: '' })).toContain('시스템 결함 의심');
  });

  it('입력 전부 없으면 모순 없음(과탐 방지)', () => {
    expect(detectContradictions({})).toEqual([]);
  });
});
