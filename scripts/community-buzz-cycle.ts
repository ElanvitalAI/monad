#!/usr/bin/env bun
// ── 커뮤니티 버즈 사이클 (P1 파이어호스 워처) · 2026-07-09 ──────────────────
//
// PLAN-community-buzz-surveillance §7 P1. cron one-shot: fetch → parse → upsert
// → velocity → 로그. 이번 페이즈는 감시·적재·velocity 까지(무LLM·무알림).
// Tier1 판정(P2)·알림(P3)·정규화(P1.5)는 후속. 크론 등록은 `monad schedule` 로.
//   예: monad schedule create --cron '*/5 9-15 * * 1-5' --command 'scripts/community-buzz-cycle.ts'

import { unknownCronFlag } from '../src/domains/cron-flag-contract.js';
import { ensureCronNodePath } from '../src/domains/cron-path.js';

// ⛔⭐ 거부는 «맨 앞»이다 — 수집·DB·발송보다 앞. `--collect-onlyy` 한 글자 오타가
//   조건을 거짓으로 만들어 «조용히 발송»하는 쪽이 기본이기 때문이다.
//   ⛔ 그리고 «한 줄»로 낸다 — 최상위 throw 는 스택 트레이스를 크론 로그로 흘린다(`#15662`).
const unknownFlag = unknownCronFlag(process.argv, { boolean: ['--collect-only'], valued: [] });
if (unknownFlag) { console.error(`⛔ 모르는 플래그: ${unknownFlag}`); process.exit(1); }

ensureCronNodePath();

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fetchFmkoreaList, CloudflareBlockedError } from '../src/domains/community-buzz/fetch.js';
import { parseFmkoreaList, parseFmkoreaPopular } from '../src/domains/community-buzz/parse-fmkorea.js';
import { openBuzzDb, upsertPosts, pruneOldBuzz, applyJudgments } from '../src/domains/community-buzz/store.js';
import { ensureSlangSeed, loadSlangEntries } from '../src/domains/community-buzz/slang-dict.js';
import { normalizeText } from '../src/domains/community-buzz/normalize.js';
import { makeLocalLlm, localLlmAvailable } from '../src/domains/community-buzz/local-llm.js';
import { judgeBuzz } from '../src/domains/community-buzz/buzz-judge.js';
import { fetchRedditHot, loadRedditSubs, loadRedditCreds } from '../src/domains/community-buzz/parse-reddit.js';
import { emergingTickers, noveltyFromVerdict, ensureEmergenceTable, recordEmergence } from '../src/domains/community-buzz/novelty.js';
import { alertCandidates, recentAlertedTitles, markAlerted, filterNewAlerts, formatBuzzAlert } from '../src/domains/community-buzz/buzz-alert.js';
import { sendOutbound } from '../src/domains/outbound-alert.js';
import { omniQuote } from '../src/domains/finance-tools.js';

const LOG = join(homedir(), '.monad/conatus/buzz_cycle.log');
// ★ A1c — 수집/알림 분리(적응형 투자): --collect-only 면 fmkorea 수집·buzz_posts 적재만 하고
//   직접 발송은 skip(알림은 signal pool 게이트/라우터가 독점). 미지정 시 기존 동작(수집+알림).
const COLLECT_ONLY = process.argv.includes('--collect-only');
function log(s: string): void {
  const stamp = `${new Date().toISOString()} ${s}`;
  console.log(s);
  try { if (!existsSync(dirname(LOG))) mkdirSync(dirname(LOG), { recursive: true }); appendFileSync(LOG, `${stamp}\n`); } catch { /* */ }
}

const POPULAR_URL = 'https://www.fmkorea.com/index.php?mid=stock&sort_index=pop&order_type=desc';

/** 한 레인 페치→파싱. 실패 시 [] (fail-soft·다른 레인 계속). */
async function fetchLane(lane: 'firehose' | 'popular'): Promise<import('../src/domains/community-buzz/parse-fmkorea.js').FmkoreaPost[]> {
  try {
    const md = lane === 'popular'
      ? await fetchFmkoreaList({ url: POPULAR_URL, waitFor: 4000 })
      : await fetchFmkoreaList({ waitFor: 4000 });
    return lane === 'popular' ? parseFmkoreaPopular(md) : parseFmkoreaList(md);
  } catch (e) {
    if (e instanceof CloudflareBlockedError) log(`[${lane}] Cloudflare 차단 — 스킵`);
    else log(`[${lane}] 페치 실패: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

async function main(): Promise<void> {
  log('=== buzz-cycle 시작 (fmkorea firehose+popular · reddit) ===');
  const db = openBuzzDb();
  ensureSlangSeed(db);
  // 사전 전체 사용(자율 진화 항목 자동 반영) — 대표 방침: 매번 수동 승인은 원치 않음.
  // 오탐만 사후 제거(bun scripts/buzz-dict-review.ts reject). onlyReviewed 게이트는 미사용.
  const entries = loadSlangEntries(db);
  const normalize = (title: string) => { const n = normalizeText(title, entries); return { tickers: n.tickers, sentiment: n.polarity }; };

  // Tier1 로컬 LLM(2대) — 살아있는 엔드포인트만. 없으면 판정 스킵(Tier0 만·fail-soft).
  const up = await localLlmAvailable();
  const llm = up.length ? makeLocalLlm({ endpoints: up }) : null;
  log(`로컬 LLM ${up.length}/2 가용${llm ? ` (${up.map(u => u.replace('http://', '')).join(', ')})` : ' — Tier1 판정 스킵'}`);

  // 한 레인 처리 — upsert(정규화 태깅) + velocity 로그 + Tier1 판정. forum/lane 무관 공용.
  const processLane = async (forum: string, lane: string, label: string, posts: import('../src/domains/community-buzz/parse-fmkorea.js').FmkoreaPost[]) => {
    if (posts.length === 0) { log(`[${label}] 게시글 0 — 스킵`); return; }
    const nowIso = new Date().toISOString();
    const r = upsertPosts(db, { forum, lane, posts, nowIso, normalize });
    log(`[${label}] 파싱 ${posts.length} · 신규 ${r.inserted} · 갱신 ${r.updated}`);
    if (r.hot.length) {
      log(`[${label}] 🔥 버즈 top${Math.min(3, r.hot.length)}(velocity×freshness×가속):`);
      for (const h of r.hot.slice(0, 3)) log(`   buzz ${h.buzzScore} (+${h.velocity}·${h.accel >= 0 ? '가속' : '감속'}${h.accel}·fresh ${h.freshness}) [${h.category}] ${h.title.slice(0, 34)}`);
    }
    if (llm && r.insertedIds.length) {
      const byId = new Map(posts.map(p => [`${forum}:${p.postId}`, p]));
      const inputs = r.insertedIds.map(id => byId.get(id)).filter(Boolean).map(p => ({ title: p!.title, tickers: normalize(p!.title).tickers, category: p!.category }));
      const verdicts = await judgeBuzz(inputs, llm);
      const judgments = verdicts.map(v => ({ id: r.insertedIds[v.i]!, importance: v.importance, spam: v.spam, polarity: v.polarity, reason: v.reason }));
      applyJudgments(db, judgments);
      const notable = judgments.filter(j => j.importance >= 7 && !j.spam);
      log(`[${label}] 🤖 Tier1 판정 ${judgments.length}/${r.insertedIds.length}${notable.length ? ` · 주목 ${notable.length}` : ''}`);
      for (const j of notable.slice(0, 3)) log(`   [imp ${j.importance}] ${byId.get(j.id)?.title.slice(0, 40)} — ${j.reason}`);
    }
  };

  try {
    // 레인 A/B — fmkorea firehose + popular
    for (const lane of ['firehose', 'popular'] as const) await processLane('fmkorea', lane, `fmk:${lane}`, await fetchLane(lane));

    // 레인 C — reddit(미국장). 워치리스트 CORE 서브·OAuth 자격 있으면 velocity·없으면 RSS.
    const subs = loadRedditSubs();
    if (subs.length) {
      const creds = loadRedditCreds();
      log(`reddit ${subs.length}서브 (${creds ? 'OAuth·velocity' : 'RSS폴백·볼륨/긍부정만·rate-limit'}): ${subs.join(', ')}`);
      for (let si = 0; si < subs.length; si++) {
        if (si > 0 && !creds) await new Promise(r => setTimeout(r, 3000)); // RSS 429 방지 서브간 딜레이
        await processLane('reddit', 'reddit-hot', `rdt:${subs[si]}`, await fetchRedditHot(subs[si]!, { creds }));
      }
    }

    // P2c — 정보 신선도(novelty): 티커 emergence(급부상) + top-1 lead/lag(비용 바운드)
    ensureEmergenceTable(db);
    const emerging = emergingTickers(db, { recentHours: 2, baselineHours: 24, minRecent: 3 });
    if (emerging.length) {
      const nowIso = new Date().toISOString();
      log(`🌟 부상 티커 ${emerging.length}: ${emerging.slice(0, 4).map(e => `${e.ticker}(x${e.ratio}·${e.recent}건)`).join(' ')}`);
      const top = emerging[0]!;
      // 외부 lead/lag 은 top-1·ratio≥3·같은 티커 3h 미검증일 때만(비용 바운드).
      const checkedRecently = db.prepare(`SELECT 1 FROM ticker_emergence WHERE ticker=? AND lead_lag IS NOT NULL AND ts >= datetime('now','-3 hours')`).get(top.ticker);
      let nov: ReturnType<typeof noveltyFromVerdict> | undefined;
      if (top.ratio >= 3 && !checkedRecently) {
        try {
          const { factCheck } = await import('../src/domains/fact-check.js');
          const q = top.titles[0] ?? top.ticker;
          const r = await factCheck({ query: q, limit: 4 });
          nov = noveltyFromVerdict(r.verdict);
          log(`   lead/lag [${top.ticker}] "${q.slice(0, 28)}" → ${r.verdict} = ${nov.label}`);
        } catch { /* fail-soft */ }
      }
      // 백테스트 승급 앵커 — emergence "시점"의 현물가·커뮤니티 감정 스냅샷(forward-return 측정용).
      // 티커별 1회 조회(중복 제거). 시세는 fail-soft(장외/미상장 null → forward 대상서 자동 제외).
      const snapOf = new Map<string, { price: number | null; sentiment: number | null }>();
      for (const e of emerging) {
        if (snapOf.has(e.ticker)) continue;
        let price: number | null = null;
        try { price = omniQuote(e.ticker)?.close ?? null; } catch { /* fail-soft */ }
        const srow = db.prepare(`SELECT AVG(sentiment) a FROM buzz_posts WHERE tickers LIKE ? AND sentiment IS NOT NULL AND ts >= datetime('now','-6 hours')`).get(`%${e.ticker}%`) as { a: number | null };
        snapOf.set(e.ticker, { price, sentiment: srow?.a ?? null });
      }
      for (const e of emerging) recordEmergence(db, nowIso, e, e.ticker === top.ticker ? nov : undefined, snapOf.get(e.ticker));
    }

    // P3a — 알림(중요만·나머지 필터). importance≥8·非spam·미알림, 6h 유사중복 억제·사이클당 상한 3.
    // ★ A1c(적응형 투자): --collect-only 면 발송 skip(수집/알림 분리·pool 적재만·게이트가 알림 독점).
    const cands = COLLECT_ONLY ? [] : alertCandidates(db, { minImportance: 8, hours: 3, limit: 8 });
    const fresh = filterNewAlerts(cands, recentAlertedTitles(db, 6)).slice(0, 3);
    if (fresh.length) {
      const text = formatBuzzAlert(fresh);
      if (text) {
        let ok = false;
        try { ok = sendOutbound(text, 'alert'); } catch (e) { log(`알림 발송 오류: ${e instanceof Error ? e.message : String(e)}`); }
        markAlerted(db, fresh.map(f => f.id)); // 발송/보류 무관 재알림 방지
        log(`🔔 버즈 알림 ${fresh.length}건 ${ok ? '발송' : '실패/보류'}: ${fresh.map(f => `[${f.importance}]${f.title.slice(0, 20)}`).join(' · ')}`);
      }
    }

    const pruned = pruneOldBuzz(db, 48);
    if (pruned) log(`prune ${pruned}`);
    log('=== buzz-cycle 완료 ===');
  } finally { db.close(); }
}

main().catch((e) => { log(`치명 오류: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
