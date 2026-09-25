#!/usr/bin/env bun
// ── 대시보드 라이브 스냅샷 수집 (2026-07-07 · 대표: "장중 2시간마다 파악") ──
// 시장 세션(US 정규/프리/애프터·US 주간거래·KR)이 살아있을 때만 섹터 ETF·지수·
// 대표종목 시세를 live_snapshot.json 으로 캐시. 대시보드 API 는 파일만 읽음.
// 알림 아님(파일 캐시) — 야간 무음과 무관.
// cron: 5 */2 * * * (짝수시 05분 · 세션 게이트로 휴장 자동 skip)

import { collectLiveSnapshot } from '../src/domains/market-live.js';
import { marketSessions } from '../src/domains/finance.js';
import { homedir } from 'node:os';

// 07-07 관찰 수리: homebrew/bun 주입만으론 부족(node=nvm 전용) — nvm bin 동적 주입.
import { ensureCronNodePath } from '../src/domains/cron-path.js';
ensureCronNodePath();

const s = marketSessions();
const alive = s.usLive || s.krLive || s.usOvernight;
if (!alive && !process.argv.includes('--force')) {
  console.log(`시장 세션 없음 (US=${s.us} · KR=${s.kr}) — skip`);
  process.exit(0);
}
const r = collectLiveSnapshot({ session: { us: s.us, kr: s.kr } });
console.log(`라이브 스냅샷 ${r.count}종 확보 → ${r.path} (US=${s.us} · KR=${s.kr})`);
