import { describe, it, expect } from 'bun:test';
import { renderRfcDesignBlock } from './mission-rfc-store.js';

// ★ ②RFC 내용 주입(근본·2026-07-22) 순수 렌더러 계약 — RFC-preset 미션에서 walker/SE 가 설계 본문을
//   못 보고 즉흥 확장하던 근본(핸드오프 3근본 #2) 해소. 경로만 주고 Read 기대하지 않음(확실 가시성).
describe('renderRfcDesignBlock — RFC 설계 계약 블록', () => {
  const path = '/state/missions/apm_x/rfc.md';

  it('빈 markdown 은 빈 문자열(비-RFC 미션 무영향)', () => {
    expect(renderRfcDesignBlock('', path)).toBe('');
    expect(renderRfcDesignBlock('   \n  ', path)).toBe('');
  });

  it('본문을 계약 헤더+설계 델리미터로 감싸 주입(경로만 아닌 내용)', () => {
    const md = '# RFC — X\n\n## 설계\n- 경계: A 모듈만\n- 무회귀: 기존 유지';
    const block = renderRfcDesignBlock(md, path);
    expect(block).toContain('RFC 설계 계약 — 반드시 준수');
    expect(block).toContain('즉흥적으로 새로 만들지 마라');
    expect(block).toContain('--- RFC 설계 ---');
    expect(block).toContain('경계: A 모듈만');   // 본문이 실제 실림(경로만 아님)
    expect(block).toContain('--- /RFC 설계 ---');
  });

  it('짧은 본문은 절단 안내 없음', () => {
    const block = renderRfcDesignBlock('# 짧은 RFC', path, 8000);
    expect(block).not.toContain('절단됨');
    expect(block).not.toContain(path);   // 절단 안 하면 경로 노출 불필요
  });

  it('maxChars 초과 시 절단하고 전문 경로 안내', () => {
    const md = '# RFC\n' + 'x'.repeat(200);
    const block = renderRfcDesignBlock(md, path, 50);
    expect(block).toContain('절단됨');
    expect(block).toContain(path);   // 전문 Read 경로 노출
    // 절단 본문이 원본보다 짧다
    const bodyStart = block.indexOf('--- RFC 설계 ---') + '--- RFC 설계 ---'.length;
    const bodyEnd = block.indexOf('… (절단됨');
    expect(bodyEnd - bodyStart).toBeLessThan(md.length + 20);
  });
});
