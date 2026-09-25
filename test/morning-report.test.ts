// 종합 아침 브리핑 오케스트레이터. 섹션은 로컬 DB 를 읽고(이 머신엔 있고 CI 엔 없음)
// 각 fail-soft. 가드: 부작용 없이(upload:false·narrate:false) 비어있지 않은 에센셜을
// 조립하고 never throws. 상세 테이블(Backbone 등)은 이제 S3 상세 리포트로 이관됐으므로
// 에센셜엔 없다 — 에센셜 고유 계약만 검증.

import { describe, test, expect } from 'bun:test';
import { composeMorningReport } from '../src/domains/morning-report.js';

describe('composeMorningReport (에센셜)', () => {
  // 라이브 소스(omni-market·finviz·dispatch)를 타므로 넉넉한 타임아웃 — 데브머신 통합 가드.
  test('부작용 없이 fail-soft 에센셜 조립 — never throws', async () => {
    const md = await composeMorningReport(new Date('2026-07-05T08:00:00Z'), { upload: false, narrate: false });
    expect(typeof md).toBe('string');
    expect(md).toContain('아침 브리핑');
    expect(md).toContain('verify+HITL');
  }, 60_000);

  // LLM 시장서사는 strictly additive — narrate off(기본) 시 서사 블록 헤더가 없어야 한다.
  test('narrate off — 서사 블록 없음', async () => {
    const now = new Date('2026-07-05T08:00:00Z');
    const base = await composeMorningReport(now, { upload: false });
    expect(base).not.toContain('오늘의 시장');
  }, 60_000);
});
