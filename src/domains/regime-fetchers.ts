// ── 국면 축 방향 매핑 (C1 · M1.2 · 2026-07-07) ─────────────────────────
//
// 각 신호 축의 raw 지표를 AxisSignal(방향·강도·신뢰도)로 매핑하는 순수함수들.
// 대표 승인 기본 규칙(2026-07-07): direction=지표 부호 · strength=|지표| 정규화 ·
// confidence=데이터 두께. 지정학은 방향 필드가 없어 "고impact 몰림=불확실성=risk-off
// 근사"(낮은 conf). 실 소스 조회(raw 추출)는 오케스트레이터(collectAxisSignals·M1.2b).
//
// ★ 순수함수 — 테스트 결정론. raw 부재/실패 = confidence 0(fail-soft·국면 벡터 기여 0).

import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AxisSignal } from './regime-synth.js';
import { REGIME_AXES } from './regime-axes.js';
import { computeDislocations } from './dislocation.js';
import { computeSectorFusion } from './sector-fusion.js';
import { knowledge13fDbPath } from './sec-13f.js';
import { openMacroDb, macroTrend, recentMacro } from './macro-store.js';
import { conatusPath } from './conatus-data-dir.js';
import { hoursAgo, windowCompare } from '../time/db-window.js';

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const dirOf = (x: number, eps = 1e-9): -1 | 0 | 1 => (x > eps ? 1 : x < -eps ? -1 : 0);
const r2 = (x: number): number => Math.round(x * 100) / 100;

/** ★ M3.4 신선도 계수(0..1) — 일일 갱신 기대 데이터의 나이 기반. 주말 커버 위해 완만:
 *  0-2일 1.0(오늘/어제/주말) · 3일 0.85 · 4-5일 0.6 · 6일+ 0.35. 파이프라인 방치(며칠+
 *  stale) 시 그 축 신뢰도를 자동 하향 → 잘못된 국면 판정 방지. date 파싱 실패 = 1(감쇠
 *  안 함·안전).
 *  graceDays = 정상 갱신 리듬(이 나이까지는 신선으로 간주·초과분에만 곡선 적용). 저빈도
 *  소스(13F 분기 등)는 grace 를 줘야 "정상 지연"을 stale 로 오판하지 않는다(us_sector
 *  M3.4b·2026-07-08). 일일 축은 grace 0(기본). */
export function freshnessDecay(asOfDate: string, now: string, graceDays = 0): number {
  const a = Date.parse(`${asOfDate.slice(0, 10)}T00:00:00Z`);
  const n = Date.parse(`${now.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(n)) return 1;
  const days = Math.max(0, Math.floor((n - a) / 86_400_000) - graceDays);
  if (days <= 2) return 1;      // 오늘·어제·주말 커버(또는 grace 이내)
  if (days === 3) return 0.85;
  if (days <= 5) return 0.6;
  return 0.35;                  // 6일+ = 심각히 오래됨(파이프라인 방치 의심)
}

/** AxisSignal 에 신선도 감쇠 적용(confidence 곱·note 에 stale 표기). f≥1이면 원본 유지. */
function applyFreshnessDecay(sig: AxisSignal, asOfDate: string, now: string, graceDays = 0): AxisSignal {
  const f = freshnessDecay(asOfDate, now, graceDays);
  if (f >= 1) return sig;
  return { ...sig, confidence: clamp01(sig.confidence * f), note: `${sig.note} · stale×${f}` };
}

/** 자산흐름 — risk-on 자산군(주식·crypto·commodity) up vs risk-off(bonds·cash) 순점수.
 *  riskOnScore ∈ [-1,1](양수=위험선호). conf=backbone 신선도. */
export function mapAssetFlow(raw: { riskOnScore: number; conf: number }): AxisSignal {
  return { axis: 'asset_flow', direction: dirOf(raw.riskOnScore), strength: clamp01(Math.abs(raw.riskOnScore)),
    confidence: clamp01(raw.conf), note: `backbone riskOn ${r2(raw.riskOnScore)}` };
}

/** ★ B 매크로 금리·달러(macro-store 추세) — 미10년 수익률↑ + 원화약세(USDKRW↑) =
 *  risk-off(-1). 금리↓+원화강세 = risk-on(+1). 둘 일치=conf 0.7 · 부분=0.4 · 부족=0.
 *  asset_flow 와 상보(중복 축소 위해 weight 0.05). 데이터 2일↑ 축적돼야 신호. */
export function mapMacroRates(raw: { ust10yChange?: number; usdkrwChange?: number }): AxisSignal {
  const yc = raw.ust10yChange, fc = raw.usdkrwChange;
  const yDir = typeof yc === 'number' && Math.abs(yc) >= 0.05 ? (yc > 0 ? -1 : 1) : 0; // 금리↑=risk-off
  const fDir = typeof fc === 'number' && Math.abs(fc) >= 3 ? (fc > 0 ? -1 : 1) : 0;     // 원화약세=risk-off
  const active = (yDir !== 0 ? 1 : 0) + (fDir !== 0 ? 1 : 0);
  const sum = yDir + fDir;
  const direction: -1 | 0 | 1 = sum > 0 ? 1 : sum < 0 ? -1 : 0;
  const strength = clamp01((Math.abs(yc ?? 0) / 0.2 + Math.abs(fc ?? 0) / 20) / 2);
  const confidence = active === 0 ? 0 : (yDir !== 0 && fDir !== 0 && yDir === fDir) ? 0.7 : 0.4;
  return { axis: 'macro_rates', direction, strength, confidence, note: `미10년 ${yc != null ? r2(yc) : '-'}%p · 원달러 ${fc != null ? r2(fc) : '-'}` };
}

/** 외국인/기관 시장 수급 — net_qty 합 부호(양수=순매수=risk-on). points=관측 종목수. */
export function mapKrFlow(raw: { netQtySum: number; points: number }): AxisSignal {
  return { axis: 'kr_flow', direction: dirOf(raw.netQtySum), strength: clamp01(Math.abs(raw.netQtySum) / 5e6),
    confidence: clamp01(raw.points / 10), note: `외국인/기관 순매수 ${Math.round(raw.netQtySum).toLocaleString()}주` };
}

/** 한국 섹터 — 1위 섹터 모멘텀(mom) 부호 × 외국인 크로스. 외국인이 그 섹터로 같은 방향이면
 *  신뢰도↑(확증). topMom=최상위 섹터 모멘텀 · foreignAligned=외국인 자금이 같은 방향인가. */
export function mapKrSector(raw: { topMom: number; foreignAligned: boolean; points: number }): AxisSignal {
  const base = clamp01(raw.points / 5);
  return { axis: 'kr_sector', direction: dirOf(raw.topMom), strength: clamp01(Math.abs(raw.topMom) / 3),
    confidence: clamp01(base * (raw.foreignAligned ? 1 : 0.5)),
    note: `섹터 mom ${r2(raw.topMom)}${raw.foreignAligned ? '·외국인 확증' : '·외국인 미확증'}` };
}

/** 한국장 펄스 — 스크리닝 종목 등락률 평균 부호(양수=강세). avgChgPct(%)·points=종목수. */
export function mapKrPulse(raw: { avgChgPct: number; points: number }): AxisSignal {
  return { axis: 'kr_pulse', direction: dirOf(raw.avgChgPct), strength: clamp01(Math.abs(raw.avgChgPct) / 3),
    confidence: clamp01(raw.points / 10), note: `종목 평균등락 ${r2(raw.avgChgPct)}%` };
}

/** 커뮤니티 버즈 — fmkorea Tier1 판정 감정 평균 부호(양수=강세 심리). avgSentiment ∈ [-1,1]·
 *  points=관측 글수(importance≥5·non-spam·4h창). conf=표본크기(10글=만충·대표 2026-07-15 상향:
 *  15→10 = 커뮤니티 비중 중간 상향, 더 적은 표본으로 만충 신뢰). 여전히 정성 노이즈라 얇게. */
export function mapCommunityBuzz(raw: { avgSentiment: number; points: number }): AxisSignal {
  return { axis: 'community_buzz', direction: dirOf(raw.avgSentiment), strength: clamp01(Math.abs(raw.avgSentiment)),
    confidence: clamp01(raw.points / 10), note: `커뮤니티 감정 ${r2(raw.avgSentiment)}·n=${raw.points}` };
}

/** 미국 섹터(13F) — 가격 vs 기관 발산 부호(양수=가격↑기관↑ 확증 축적). divergence ∈ [-1,1]. */
export function mapUsSector(raw: { divergence: number; conf: number }): AxisSignal {
  return { axis: 'us_sector', direction: dirOf(raw.divergence), strength: clamp01(Math.abs(raw.divergence)),
    confidence: clamp01(raw.conf), note: `13F 발산 ${r2(raw.divergence)}` };
}

/** 미국장 펄스 — 주간변동 평균 부호(선행). avgWeekPct(%)·points=종목수. */
export function mapUsPulse(raw: { avgWeekPct: number; points: number }): AxisSignal {
  return { axis: 'us_pulse', direction: dirOf(raw.avgWeekPct), strength: clamp01(Math.abs(raw.avgWeekPct) / 12),
    confidence: clamp01(raw.points / 10), note: `주간변동 ${r2(raw.avgWeekPct)}%` };
}

/** 지정학·매크로 — 방향 필드 부재. 고impact 이벤트 몰림 = 불확실성 = risk-off 경향(근사·
 *  낮은 conf). highImpactCount=최근 24h impact≥8 건수 · avgImpact=평균 강도. 절대 risk-on 안 함. */
export function mapGeopolitics(raw: { highImpactCount: number; avgImpact: number; threshold?: number }): AxisSignal {
  const th = raw.threshold ?? 5;
  const direction = raw.highImpactCount >= th ? -1 : 0; // 몰림=risk-off·아니면 중립
  return { axis: 'geopolitics', direction, strength: clamp01(raw.avgImpact / 10),
    confidence: direction === 0 ? 0.1 : 0.35, // 방향 근사라 신뢰도 낮게
    note: `고impact ${raw.highImpactCount}건(평균 ${r2(raw.avgImpact)})` };
}

/** 괴리(전환 축·weight 0) — 실측 vs 센티 gap 부호. 양수=실측>센티(저평가·잠재 risk-on).
 *  strong=강한 괴리(전환 조기신호). transition 판정에 direction·strength 사용. */
export function mapDislocation(raw: { gap: number; strong: boolean }): AxisSignal {
  return { axis: 'dislocation', direction: dirOf(raw.gap), strength: raw.strong ? 0.7 : clamp01(Math.abs(raw.gap)),
    confidence: raw.strong ? 0.6 : 0.3, note: `괴리 gap ${r2(raw.gap)}${raw.strong ? '·강' : ''}` };
}

// ── 오케스트레이터 (M1.2b) — 실 소스 raw 추출 → 매핑 → AxisSignal[] ──────
//
// 한국 3축(kr_flow·kr_sector·kr_pulse)+지정학은 screener/breaking DB 직접 쿼리로
// 실배선. asset_flow·us_sector·us_pulse·dislocation은 도구 파싱이라 후속(현재 nil·
// fail-soft). synthesizeRegime는 conf 0 축을 자동 무시(기여 0)하므로 부분 신호로도
// 국면 벡터가 나온다(한국 0.52 + 지정학 0.06 = 0.58 실커버).

const SCREENER_DB = conatusPath('screener.db');
const BREAKING_DB = conatusPath('breaking_signals.db');
const US_PULSE_DB = conatusPath('us_pulse.db');
const BUZZ_DB = conatusPath('community_buzz.db');
const X_ASSET_DB = join(homedir(), '.claude/skills/apify-x-asset-sentiment/data/x_asset.db');

/** risk-on 자산군(위험선호 시 상승). gold는 안전자산 성격 병존 → 중립 제외. */
const RISK_ON_ASSETS = new Set(['equities', 'crypto', 'commodities']);
const RISK_OFF_ASSETS = new Set(['bonds', 'cash']);

/** 각 축 raw 추출기(주입 가능·fail-soft). 미주입/실패 = 그 축 confidence 0. */
// asOfDate = 그 축 데이터의 MAX(date)(YYYY-MM-DD) — 신선도 감쇠(M3.4)용. 일일 갱신
// 기대 축(asset_flow·kr 3축·us_pulse) + us_sector(13F 최신 period·grace 감쇠·M3.4b)가
// 제공 · 지정학(-24h 동적필터)은 미제공(감쇠 스킵).
export interface RawFetchers {
  assetFlow?: () => { riskOnScore: number; conf: number; asOfDate?: string } | null;
  macroRates?: () => { ust10yChange?: number; usdkrwChange?: number; asOfDate?: string } | null;
  krFlow?: () => { netQtySum: number; points: number; asOfDate?: string } | null;
  krSector?: () => { topMom: number; foreignAligned: boolean; points: number; asOfDate?: string } | null;
  krPulse?: () => { avgChgPct: number; points: number; asOfDate?: string } | null;
  communityBuzz?: () => { avgSentiment: number; points: number; asOfDate?: string } | null;
  usSector?: () => { divergence: number; conf: number; asOfDate?: string } | null;
  usPulse?: () => { avgWeekPct: number; points: number; asOfDate?: string } | null;
  geopolitics?: () => { highImpactCount: number; avgImpact: number } | null;
  dislocation?: () => { gap: number; strong: boolean } | null;
}

/** 배선 안 된/실패 축 = 관측용 conf 0 신호(어느 축이 살아있나 가시). */
const nil = (axis: AxisSignal['axis']): AxisSignal => ({ axis, direction: 0, strength: 0, confidence: 0, note: '미배선/실패' });
const safe = <T>(fn: (() => T | null) | undefined): T | null => { if (!fn) return null; try { return fn(); } catch { return null; } };
const openRO = (path: string): Database | null => (existsSync(path) ? new Database(path, { readonly: true }) : null);

/** 13F 최신 공시분기(period·YYYY-MM-DD) — us_sector 신선도 감쇠용. 없으면 null(감쇠 스킵). */
function latest13fPeriod(): string | null {
  const db = openRO(knowledge13fDbPath()); if (!db) return null;
  try {
    const r = db.query(`SELECT MAX(period) p FROM fact_13f_holdings`).get() as { p: string | null } | null;
    return r?.p ?? null;
  } catch { return null; } finally { db.close(); }
}

/** 13F 분기 grace(일) — 정상 공시 리듬(분기 90 + SEC 45일 지연 = ~135) 이내는 신선 간주.
 *  이를 넘겨 다음 분기 데이터가 ingest 안 되면(방치) freshnessDecay 곡선 발동. 150 여유. */
const F13_GRACE_DAYS = 150;

/** 실 소스 → 8축 AxisSignal[](REGIME_AXES 순서). raw 주입(테스트) 또는 기본. Never throws.
 *  now 제공 시 일일 축(asset_flow·kr 3축·us_pulse)에 신선도 감쇠 적용(M3.4·asOfDate 기반).
 *  us_sector(13F 분기)는 grace 150일 넘겨 방치 시만 감쇠(M3.4b) · 지정학(-24h 동적필터)은 스킵. */
export function collectAxisSignals(raw: RawFetchers = defaultRawFetchers(), now?: string): AxisSignal[] {
  const a = safe(raw.assetFlow), mr = safe(raw.macroRates), kf = safe(raw.krFlow), ks = safe(raw.krSector), kp = safe(raw.krPulse);
  const cb = safe(raw.communityBuzz);
  const us = safe(raw.usSector), up = safe(raw.usPulse), gp = safe(raw.geopolitics), dl = safe(raw.dislocation);
  // 신선도 감쇠: now + asOfDate 둘 다 있을 때만. 없으면 원본(하위호환·안전).
  const fresh = (sig: AxisSignal, r: { asOfDate?: string } | null, graceDays = 0): AxisSignal =>
    (now && r?.asOfDate) ? applyFreshnessDecay(sig, r.asOfDate, now, graceDays) : sig;
  return [
    a ? fresh(mapAssetFlow(a), a) : nil('asset_flow'),
    mr ? mapMacroRates(mr) : nil('macro_rates'),   // 추세 기반 — 감쇠 스킵(asOfDate 있어도 추세 자체가 최신)
    kf ? fresh(mapKrFlow(kf), kf) : nil('kr_flow'),
    ks ? fresh(mapKrSector(ks), ks) : nil('kr_sector'),
    kp ? fresh(mapKrPulse(kp), kp) : nil('kr_pulse'),
    cb ? mapCommunityBuzz(cb) : nil('community_buzz'), // 4h창 필터가 신선도 게이트(정지 시 n=0→conf0)
    us ? fresh(mapUsSector(us), us, F13_GRACE_DAYS) : nil('us_sector'), // 13F 분기 — grace 넘겨 방치 시만 감쇠
    up ? fresh(mapUsPulse(up), up) : nil('us_pulse'),
    gp ? mapGeopolitics(gp) : nil('geopolitics'),      // -24h 동적필터 — 항상 신선(스킵)
    dl ? mapDislocation(dl) : nil('dislocation'),      // backbone/sentiment 파생(asOfDate 없음)
  ];
}

/** 실 DB 기반 raw 추출기(한국 3축 + 지정학). 나머지 = 후속(nil·fail-soft). */
export function defaultRawFetchers(): RawFetchers {
  return {
    // 외국인+기관 시장 순매수 합(부호=방향).
    krFlow: () => {
      const db = openRO(SCREENER_DB); if (!db) return null;
      try {
        const r = db.query(`SELECT COALESCE(SUM(net_qty),0) s, COUNT(*) n, (SELECT MAX(date) FROM investor) d FROM investor WHERE date=(SELECT MAX(date) FROM investor) AND type IN ('외국인','기관')`).get() as { s: number; n: number; d: string } | null;
        return r && r.n ? { netQtySum: r.s, points: r.n, asOfDate: r.d } : null;
      } finally { db.close(); }
    },
    // 1위 섹터 모멘텀 + 외국인이 그 섹터로(name 조인) 같은 방향인가(확증).
    krSector: () => {
      const db = openRO(SCREENER_DB); if (!db) return null;
      try {
        // ★ SP3: monad sector_scores(rolling window·monthly·TS 계산) 우선 — 오늘 기준이라
        //   신선(레거시 sector 는 외부 파이썬 월봉이라 stale). 없으면 레거시 sector 폴백.
        let chain: string, mom: number, asOf: string, points: number;
        const sw = db.query(`SELECT chain, mom, date FROM sector_scores WHERE market='KR' AND window='monthly' AND date=(SELECT MAX(date) FROM sector_scores WHERE market='KR' AND window='monthly') ORDER BY rank LIMIT 1`).get() as { chain: string; mom: number; date: string } | null;
        if (sw) {
          chain = sw.chain; mom = sw.mom; asOf = sw.date;
          points = (db.query(`SELECT COUNT(*) n FROM sector_scores WHERE market='KR' AND window='monthly' AND date=?`).get(sw.date) as { n: number } | null)?.n ?? 0;
        } else {
          const legacy = db.query(`SELECT chain, mom, (SELECT MAX(date) FROM sector) d, (SELECT COUNT(*) FROM sector WHERE date=(SELECT MAX(date) FROM sector)) n FROM sector WHERE date=(SELECT MAX(date) FROM sector) ORDER BY rank LIMIT 1`).get() as { chain: string; mom: number; d: string; n: number } | null;
          if (!legacy) return null;
          chain = legacy.chain; mom = legacy.mom; asOf = legacy.d; points = legacy.n;
        }
        // 외국인 크로스: 서브체인 chain → 카테고리(·앞) → screen.chain 매칭(기존 로직 재사용).
        const category = chain.split('·')[0] ?? chain;
        const fx = db.query(`SELECT COALESCE(SUM(i.net_qty),0) s FROM investor i JOIN screen sc ON i.name=sc.name AND sc.date=(SELECT MAX(date) FROM screen) WHERE sc.chain=? AND i.type='외국인' AND i.date=(SELECT MAX(date) FROM investor)`).get(category) as { s: number } | null;
        const foreignAligned = !!fx && fx.s !== 0 && Math.sign(fx.s) === Math.sign(mom);
        return { topMom: mom, foreignAligned, points, asOfDate: asOf };
      } finally { db.close(); }
    },
    // 스크리닝 종목 등락률 평균(부호=강세/약세).
    krPulse: () => {
      const db = openRO(SCREENER_DB); if (!db) return null;
      try {
        const r = db.query(`SELECT AVG(chg_pct) a, COUNT(*) n, (SELECT MAX(date) FROM screen) d FROM screen WHERE date=(SELECT MAX(date) FROM screen)`).get() as { a: number; n: number; d: string } | null;
        return r && r.n ? { avgChgPct: r.a ?? 0, points: r.n, asOfDate: r.d } : null;
      } finally { db.close(); }
    },
    // 커뮤니티 버즈 — Tier1 판정 감정 평균(importance≥5·non-spam·4h창). 정지 시 n=0→conf0.
    communityBuzz: () => {
      const db = openRO(BUZZ_DB); if (!db) return null;
      try {
        const r = db.query(`SELECT AVG(sentiment) a, COUNT(*) n FROM buzz_posts WHERE spam=0 AND importance >= 5 AND sentiment IS NOT NULL AND ${windowCompare('fetch_ts', '>')}`).get(hoursAgo(4)) as { a: number; n: number } | null;
        return r && r.n ? { avgSentiment: r.a ?? 0, points: r.n } : null;
      } finally { db.close(); }
    },
    // 24h 고impact 이벤트 몰림(불확실성=risk-off 근사).
    geopolitics: () => {
      const db = openRO(BREAKING_DB); if (!db) return null;
      try {
        const r = db.query(`SELECT COUNT(*) c, COALESCE(AVG(impact),0) a FROM signals WHERE ${windowCompare('ts', '>')} AND impact >= 8`).get(hoursAgo(24)) as { c: number; a: number } | null;
        return r ? { highImpactCount: r.c, avgImpact: r.a } : null;
      } finally { db.close(); }
    },
    // 전세계 자산흐름 — x_asset backbone: risk-on 자산군 방향(up) - risk-off 방향.
    assetFlow: () => {
      const db = openRO(X_ASSET_DB); if (!db) return null;
      try {
        const maxRow = db.query(`SELECT MAX(date) d FROM fact_signal_daily WHERE scope_type='asset'`).get() as { d: string } | null;
        const rows = db.query(`SELECT scope_key, direction, COALESCE(confidence,0.5) confidence FROM fact_signal_daily WHERE scope_type='asset' AND date=(SELECT MAX(date) FROM fact_signal_daily)`).all() as Array<{ scope_key: string; direction: string; confidence: number }>;
        let sum = 0, confSum = 0, n = 0;
        for (const r of rows) {
          const side = RISK_ON_ASSETS.has(r.scope_key) ? 1 : RISK_OFF_ASSETS.has(r.scope_key) ? -1 : 0;
          if (side === 0) continue; // gold 등 중립 제외
          const dir = r.direction === 'up' ? 1 : r.direction === 'down' ? -1 : 0;
          sum += side * dir * r.confidence; confSum += r.confidence; n++;
        }
        return n ? { riskOnScore: clamp01(Math.abs(sum / n)) * Math.sign(sum), conf: confSum / n, ...(maxRow?.d ? { asOfDate: maxRow.d } : {}) } : null;
      } finally { db.close(); }
    },
    // ★ B 매크로 금리·달러 — macro-store(regime.db) 5일 추세(미10년·원달러 변화).
    //   데이터 2일↑ 축적돼야 신호(morning-report 가 매일 스냅샷 영속). 부족=null.
    macroRates: () => {
      try {
        const db = openMacroDb();
        try {
          const t = macroTrend(db, 5);
          if (t.samples < 2) return null;
          const latest = recentMacro(db, 1)[0];
          return {
            ...(t.ust10yChange !== undefined ? { ust10yChange: t.ust10yChange } : {}),
            ...(t.usdkrwChange !== undefined ? { usdkrwChange: t.usdkrwChange } : {}),
            ...(latest?.as_of ? { asOfDate: latest.as_of } : {}),
          };
        } finally { db.close(); }
      } catch { return null; }
    },
    // 미국 섹터 — 13F fusion: 강섹터(rank 상위) 기관 순매수(netB) 부호 · 발산 적을수록 확증.
    // asOfDate=13F 최신 공시분기(period) — 분기 grace(정상 지연) 넘겨 방치되면 감쇠(M3.4b).
    usSector: () => {
      const f = computeSectorFusion();
      if (!f.length) return null;
      const top = [...f].sort((a, b) => a.rank - b.rank).slice(0, 3); // rank 1 = 강
      const netSum = top.reduce((s, x) => s + x.netB, 0);            // 강섹터 기관 순매수($B)
      const divergent = f.filter(x => x.divergent).length;
      const asOfDate = latest13fPeriod();
      return { divergence: clamp01(Math.abs(netSum) / 10) * Math.sign(netSum), conf: clamp01(1 - divergent / f.length), ...(asOfDate ? { asOfDate } : {}) };
    },
    // 미국장 펄스 — us_pulse.db: 종목별 5거래일 변동률 평균(주간).
    usPulse: () => {
      const db = openRO(US_PULSE_DB); if (!db) return null;
      try {
        const r = db.query(
          `WITH ranked AS (SELECT symbol, close, ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) rn FROM bars)
           SELECT AVG((a.close - b.close) / b.close * 100) avg, COUNT(*) n, (SELECT MAX(date) FROM bars) d
           FROM ranked a JOIN ranked b ON a.symbol=b.symbol AND a.rn=1 AND b.rn=6 WHERE b.close > 0`,
        ).get() as { avg: number; n: number; d: string } | null;
        return r && r.n ? { avgWeekPct: r.avg ?? 0, points: r.n, asOfDate: r.d } : null;
      } finally { db.close(); }
    },
    // 괴리(전환 축) — backbone vs 센티. 실측>센티(=gap 뒤집기) 방향 · 강한 괴리 존재.
    dislocation: () => {
      const d = computeDislocations();
      if (!d.length) return null;
      const avgGap = d.reduce((s, x) => s + x.gap, 0) / d.length; // gap=sentiment-backbone(양수=크라우드 과열)
      const strong = d.some(x => x.severity === 'strong');
      return { gap: -avgGap, strong }; // 부호 뒤집기 → 실측>센티일 때 + (저평가·잠재 risk-on)
    },
  };
}

/** REGIME_AXES 순서 정합(오케스트레이터 출력 == 레지스트리 순서) — 디버그. */
export const AXIS_ORDER = REGIME_AXES.map(a => a.key);
