#!/usr/bin/env bun
// ── KR 투자자 수급 일별 적재 (2026-07-06 — 6/11부터 죽어있던 investor 복원) ──
// kr-flow frgn-institution(외국인/기관 매매종목 가집계) → screener.db investor.
// 장마감 후 확정 가집계 시점. dig-engine 종목 트리거(수급+가격 동반)가 소비.
// cron: 10 19 * * 1-5 (KST — 스크리너 백필 19:00 뒤)

import { ingestInvestor } from '../src/domains/kr-investor.js';
import { ingestKrBars } from '../src/domains/market-live.js';
import { homedir } from 'node:os';

// 07-07 관찰 수리: homebrew/bun 주입만으론 부족(node=nvm 전용) — nvm bin 동적 주입.
import { ensureCronNodePath } from '../src/domains/cron-path.js';
ensureCronNodePath();

try {
  const n = ingestInvestor();
  console.log(n > 0 ? `수급 적재 ${n}행 (외국인/기관 순매수 상위)` : '수급 데이터 없음 (휴장/API 빈응답) — skip');
} catch (e) {
  console.error(`수급 적재 실패: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`);
  process.exit(1);
}

// KR 섹터 ETF·대표종목 EOD 누적 (대시보드 주간/스트릭 — fail-soft·같은 크론에 합류)
try {
  const bars = ingestKrBars();
  console.log(`KR bars 적재 ${bars}행 (섹터 ETF+대표종목 · 자가치유 1개월 재조회)`);
} catch (e) {
  console.error(`KR bars 적재 실패(비치명): ${e instanceof Error ? e.message.slice(0, 100) : String(e)}`);
}
