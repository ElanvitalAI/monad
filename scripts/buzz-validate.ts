#!/usr/bin/env bun
// ── 버즈 신호 검증 (Goodhart 방지) · 주1회 크론 · 2026-07-09 ──────────────────
//
// 커뮤니티 감정 방향이 실제 가격 방향과 맞나(hit-rate). 우연(50%) 초과여야 알파.
// 예측 못 하면 노이즈 증폭 경고. 등록: monad schedule create --cron '0 7 * * 6'
//   --command 'scripts/buzz-validate.ts'

import { ensureCronNodePath } from '../src/domains/cron-path.js';
ensureCronNodePath();

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { openBuzzDb } from '../src/domains/community-buzz/store.js';
import { emergedSentiments, validateDirection, forwardCandidates, validateForwardReturns } from '../src/domains/community-buzz/validate.js';
import { ensureEmergenceTable } from '../src/domains/community-buzz/novelty.js';
import { omniQuote } from '../src/domains/finance-tools.js';

const LOG = join(homedir(), '.monad/conatus/buzz_validate.log');
function log(s: string): void {
  console.log(s);
  try { if (!existsSync(dirname(LOG))) mkdirSync(dirname(LOG), { recursive: true }); appendFileSync(LOG, `${new Date().toISOString()} ${s}\n`); } catch { /* */ }
}

async function main(): Promise<void> {
  log('=== buzz-validate 시작 (Goodhart 가드) ===');
  const db = openBuzzDb();
  try {
    ensureEmergenceTable(db); // 멱등 마이그레이션 — 기존 DB에 price/sentiment 앵커 컬럼 보장.
    // ① forward-return 백테스트(승급·진짜 예측력) — emergence 시점가 vs 현재가.
    //    가격 앵커(price_at_emergence)가 쌓인 만큼만 측정. 며칠 누적돼야 표본이 생긴다.
    const cands = forwardCandidates(db, { minHoldHours: 24, maxAgeHours: 168 });
    log(`[forward] 앵커 있는 부상 종목 ${cands.length}종(24h~7d 창 경과)`);
    if (cands.length) {
      const priceNow = (ticker: string): number | null => {
        try { return omniQuote(ticker)?.close ?? null; } catch { return null; }
      };
      const f = validateForwardReturns(cands, priceNow, { minSample: 5 });
      log(`[forward] 표본 ${f.n} · 방향표본 ${f.directional} · hit ${f.hits} · hitRate ${f.hitRate ?? '표본부족'} · 평균수익 ${f.meanRet ?? 'n/a'}% · 강세평균 ${f.meanRetBull ?? 'n/a'}%`);
      log(`[forward] 판정: ${f.note}`);
      for (const s of f.samples.slice(0, 8)) log(`   ${s.ticker} 감정${s.sentiment ?? 'n/a'} · ${s.priceAt}→${s.priceNow} = ${s.ret}% → ${s.hit == null ? '방향미평가' : s.hit ? 'HIT' : 'miss'}`);
    } else {
      log('[forward] 앵커 부족 — 가격 스냅샷 적재 중(며칠 후 forward 측정 가능).');
    }

    // ② 동시성(coincident) 방향 체크 — 승급 전 Goodhart 가드(당일 changePct·보조).
    const sents = emergedSentiments(db, { hours: 48, minPosts: 2 });
    log(`[coincident] 검증 대상 ${sents.length}종(감정 있는 부상 종목)`);
    if (sents.length > 0) {
      const priceMove = (ticker: string): number | null => {
        try { return omniQuote(ticker)?.changePct ?? null; } catch { return null; }
      };
      const r = validateDirection(sents, priceMove, { minSample: 5 });
      log(`[coincident] 표본 ${r.n} · hit ${r.hits} · hitRate ${r.hitRate ?? '표본부족'}`);
      log(`[coincident] 판정: ${r.note}`);
      for (const s of r.samples.slice(0, 8)) log(`   ${s.ticker} 감정${s.sentiment} vs 가격${s.move}% → ${s.hit ? 'HIT' : 'miss'}`);
    }
    log('=== buzz-validate 완료 ===');
  } finally { db.close(); }
}

main().catch((e) => { log(`치명 오류: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
