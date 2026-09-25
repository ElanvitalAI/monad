#!/usr/bin/env bun
// ── 속보 신호 다이제스트 (2026-07-06 · 대표 지시) ────────────────────────
// 초긴급(9점대)은 x-breaking-alert가 즉시 발송. 나머지 판정분(전량 DB 적재)을:
//   batch  — KST 08/12/15/19시 4회, digestFloor(기본 6) 이상만 모아서 요약 발송
//   week   — 일요일 저녁: 7일 상위 15건 + 통계 증류
//   month  — 매월 1일 저녁: 30일 상위 20건 + 통계 + **90일 초과 raw 휘발(prune)**
//
// cron: 0 8,12,15,19 * * * (batch) · 0 20 * * 0 (week) · 30 20 1 * * (month)
// 사용: bun scripts/breaking-digest.ts --period batch|week|month

import { sendOutbound } from '../src/domains/outbound-alert.js';
import {
  openSignalsDb, pendingDigest, markAllDigested, topSignals, periodStats, pruneOld, dedupeByText,
  recentSentSignals, type SignalRow,
} from '../src/domains/breaking-signals.js';
import { dedupeSignalsSemantic } from '../src/domains/signal-dedup.js';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// 07-07 관찰 수리: homebrew/bun 주입만으론 부족(node=nvm 전용) — nvm bin 동적 주입.
import { ensureCronNodePath } from '../src/domains/cron-path.js';
ensureCronNodePath();

const period = (process.argv.includes('--period')
  ? process.argv[process.argv.indexOf('--period') + 1] : 'batch') as 'batch' | 'week' | 'month';

function digestFloor(): number {
  try {
    const wl = JSON.parse(readFileSync(join(homedir(), '.monad/conatus/x_watchlist.json'), 'utf-8'));
    if (typeof wl.digestFloor === 'number') return wl.digestFloor;
  } catch { /* default */ }
  return 6;
}

function fmt(s: SignalRow, sources = 1): string {
  const tag = s.urgency == null ? '[판정없음]'
    : `[긴급${s.urgency}·시장${s.market}·${s.sector ?? '?'}${s.impact ?? 0}${(s.kr ?? 0) >= 6 ? `·KR${s.kr}` : ''}]`;
  const multi = sources > 1 ? ` (×${sources}개 소스 동일보도)` : '';
  const reason = s.reason ? `\n  ↳ ${s.reason}` : '';
  return `${tag} ${s.author}${multi}\n${s.text.slice(0, 180)}${reason}\n${s.url}`;
}

const db = openSignalsDb();

if (period === 'batch') {
  const rows = pendingDigest(db, digestFloor());
  // ⚠️ 최근 발송 스냅샷은 markAllDigested **전에** — 이번 배치 자기매칭 방지.
  const recent = recentSentSignals(db, 6, digestFloor());
  const total = markAllDigested(db); // floor 미만 포함 전부 소화 처리(재스캔 방지)
  if (rows.length === 0) {
    console.log(`다이제스트 대상 없음 (미소화 ${total}건은 floor 미만 — DB 기록만)`);
    db.close();
    process.exit(0);
  }
  const jaccard = dedupeByText(rows, r => r.text); // ① 동일 뉴스 다중소스 접기 (토큰)
  // ② 6h 의미 dedup (2026-07-07 대표 피드백) — 한/영 교차·1보/종합·장단문 변형을
  // LLM 배치 판정(→임베딩→Jaccard 폴백)으로 접고, 초긴급/직전 다이제스트로 이미
  // 나간 사건은 억제.
  const { kept, suppressed, method } = await dedupeSignalsSemantic(jaccard, recent);
  console.log(`의미 dedup(${method}): ${jaccard.length}→${kept.length}건 · 기발송 억제 ${suppressed}건`);
  if (kept.length === 0) {
    console.log('전 건이 기발송 중복 — 다이제스트 skip');
    db.close();
    process.exit(0);
  }
  const top = kept.slice(0, 12);
  const msg = [
    `📋 시장신호 다이제스트 (${top.length}건${kept.length > top.length ? ` / 대기 ${kept.length}` : ''} · floor ${digestFloor()}+${suppressed > 0 ? ` · 중복 접힘 ${suppressed}` : ''})`,
    ...top.map(({ item, sources }) => `\n${fmt(item, sources)}`),
    `\n(초긴급은 즉시 알림됨 · 전체 기록: breaking_signals.db · READ-ONLY)`,
  ].join('\n');
  console.log(msg);
  if (!sendOutbound(msg, 'report')) console.log('발송 실패');
  db.close();
  process.exit(0);
}

// week / month — 증류 리포트
const days = period === 'week' ? 7 : 30;
const label = period === 'week' ? '주간' : '월간';
const st = periodStats(db, days);
const top = dedupeByText(
  topSignals(db, days, period === 'week' ? 15 : 20)
    .filter(s => Math.max(s.urgency ?? 0, s.market ?? 0, s.impact ?? 0) >= digestFloor()),
  r => r.text);

if (st.total === 0) {
  console.log(`${label}: 신호 없음 — skip`);
  db.close();
  process.exit(0);
}

const sectorLine = st.bySector.length
  ? `섹터 유의(6+): ${st.bySector.map(s => `${s.sector} ${s.n}`).join(' · ')}`
  : '섹터 유의 신호 없음';
const msg = [
  `🗂 ${label} 시장신호 증류 (최근 ${days}일)`,
  `총 ${st.total}건 판정 · 초긴급 발송 ${st.alerted}건 · 시장 유의(6+) ${st.marketHot}건`,
  sectorLine, // 머니무브먼트 순환 관찰 — 어느 섹터/자산으로 신호가 몰리나
  ``,
  `── 상위 신호 ──`,
  ...top.map(({ item, sources }) => `\n${fmt(item, sources)}`),
  `\n(90일 초과 raw는 자동 휘발 · P4 지식레이어 인제스트 예정)`,
].join('\n');
console.log(msg);
if (!sendOutbound(msg, 'report')) console.log('발송 실패');

if (period === 'month') {
  const pruned = pruneOld(db, 90);
  console.log(`휘발: 90일 초과 ${pruned}건 삭제`);
}
db.close();
