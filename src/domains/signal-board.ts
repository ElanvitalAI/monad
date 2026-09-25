// ── 통합 시그널 보드 — 4 소스 recency 감지 피드 (2026-07-10) ──────────────────
//
// 대표 지시: PWA 투자 시그널 보드를 전면 개편 — 모닝브리핑 + 여러 루프에이전트가 감지한
// 내용을 한눈에. 28개 투자 루프가 신호를 쏟아내지만 대시보드는 카드별 산발이었다. 이
// 모듈은 4 소스를 하나의 최신순 감지 피드로 통합한다:
//   ① 버즈(커뮤니티) 급부상  ② 디깅+신호타임라인  ③ 국면전환+캡스톤  ④ 회고/기억 루프
// 순수 어댑터(각 소스 raw → SignalDetection) + mergeFeed(최신순·cap). 실 수집은 API 층에서
// 주입(fail-soft). 국면/캡스톤은 hero, 나머지는 통합 feed.

export type SignalSource = 'buzz' | 'dig' | 'signal' | 'regime' | 'reflection';

export interface SignalDetection {
  source: SignalSource;
  ts: string;            // ISO — 최신순 정렬 키
  title: string;         // 짧은 헤드라인
  detail?: string;       // 부연
  score?: number;        // 부호/강도(소스별 의미 다름 — buzz=ratio·signal=urgency·regime=composite)
  ticker?: string;
  link?: string;
}

// ── 어댑터(순수) ─────────────────────────────────────────────────────────────

export interface EmergingLike { ticker: string; recent: number; ratio: number; titles: string[] }

/** 버즈 급부상 → 감지. sentiment 맵(있으면 방향 부호). 최초관측 ts 는 주입(now·근사). */
export function buzzToDetections(emerging: EmergingLike[], sentiments: Map<string, number>, nowIso: string): SignalDetection[] {
  return emerging.map(e => {
    const s = sentiments.get(e.ticker);
    const dir = s == null ? '' : s > 0.15 ? ' 📈강세' : s < -0.15 ? ' 📉약세' : '';
    return {
      source: 'buzz' as const, ts: nowIso, ticker: e.ticker,
      title: `${e.ticker} 급부상 x${e.ratio}${dir}`,
      detail: `${e.recent}건 언급${e.titles[0] ? ` · "${e.titles[0].slice(0, 40)}"` : ''}`,
      score: e.ratio,
    };
  });
}

export interface DigLike { id?: string; ts: string; topic?: string; sector?: string; verdict?: string; confidence?: number }

export function digsToDetections(rows: DigLike[]): SignalDetection[] {
  return rows.map(r => ({
    source: 'dig' as const, ts: r.ts,
    title: `🔎 ${r.topic ?? '디깅'}${r.sector ? ` · ${r.sector}` : ''}`,
    detail: (r.verdict ?? '').slice(0, 120),
    ...(r.confidence != null ? { score: r.confidence } : {}),
  }));
}

export interface TimelineLike { id?: string; ts: string; author?: string; text?: string; url?: string; urgency?: number; market?: number; impact?: number; sector?: string; reason?: string; alerted?: number }

export function timelineToDetections(rows: TimelineLike[]): SignalDetection[] {
  return rows.map(r => {
    const sev = Math.max(r.urgency ?? 0, r.market ?? 0, r.impact ?? 0);
    return {
      source: 'signal' as const, ts: r.ts,
      title: `${r.alerted ? '🚨 ' : ''}${(r.reason || r.text || '신호').slice(0, 60)}`,
      detail: `${r.author ? `@${r.author} · ` : ''}${r.sector ? `${r.sector} · ` : ''}${(r.text || '').slice(0, 100)}`,
      score: sev,
      ...(r.url ? { link: r.url } : {}),
    };
  });
}

// regime-store 는 camelCase 반환(asOf·regimeLabel·transition:boolean). 형태 정합 필수.
export interface RegimeLike { asOf: string; composite: number | null; regimeLabel: string | null; transition: boolean | number | null; transitionAxes?: string[] | string | null }

/** 국면 벡터 시계열 → 전환 감지(transition truthy 인 것만). 최신 국면은 hero 로 별도. */
export function regimeToDetections(recent: RegimeLike[]): SignalDetection[] {
  return recent.filter(r => r.transition).map(r => {
    const axes = Array.isArray(r.transitionAxes) ? r.transitionAxes.join(',') : (r.transitionAxes ?? '');
    return {
      source: 'regime' as const, ts: r.asOf,
      title: `🧭 국면 전환 → ${r.regimeLabel ?? '?'}`,
      detail: `composite ${r.composite?.toFixed(3) ?? '?'}${axes ? ` · 축:${axes}` : ''}`,
      ...(r.composite != null ? { score: r.composite } : {}),
    };
  });
}

export interface ReflectionHitLike { ts: string; summary?: string | null; text?: string; tags?: string | null }

export function reflectionToDetections(hits: ReflectionHitLike[]): SignalDetection[] {
  return hits.map(h => {
    const loop = (h.tags ?? '').split(',').find(t => t.startsWith('loop:'))?.slice(5) ?? 'loop';
    return {
      source: 'reflection' as const, ts: h.ts,
      title: `🧠 ${loop} 회고`,
      detail: (h.summary || h.text || '').slice(0, 120),
    };
  });
}

/** 여러 소스 감지를 최신순 통합·cap. 빈 ts 는 뒤로. */
export function mergeFeed(groups: SignalDetection[][], limit = 40): SignalDetection[] {
  const all = groups.flat();
  all.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
  return all.slice(0, limit);
}

// ── 보드 조립 ────────────────────────────────────────────────────────────────

export interface SignalBoardHeroRegime { label: string | null; composite: number | null; asOf: string; transition: boolean }
export interface SignalBoardInputs {
  emerging: EmergingLike[];
  sentiments: Array<{ ticker: string; sentiment: number }>;
  digs: DigLike[];
  timeline: TimelineLike[];
  regimeRecent: RegimeLike[];
  regimeLatest: RegimeLike | null;
  capstone: Record<string, unknown> | null;
  reflectionHits: ReflectionHitLike[];
  nowIso: string;
  feedLimit?: number;
}

export interface SignalBoard {
  generatedAt: string;
  regime: SignalBoardHeroRegime | null;
  capstone: Record<string, unknown> | null;
  feed: SignalDetection[];
  bySource: Record<string, number>;
}

export function buildSignalBoard(inp: SignalBoardInputs): SignalBoard {
  const sentMap = new Map(inp.sentiments.map(s => [s.ticker, s.sentiment]));
  const feed = mergeFeed([
    buzzToDetections(inp.emerging, sentMap, inp.nowIso),
    digsToDetections(inp.digs),
    timelineToDetections(inp.timeline),
    regimeToDetections(inp.regimeRecent),
    reflectionToDetections(inp.reflectionHits),
  ], inp.feedLimit ?? 40);

  const bySource: Record<string, number> = {};
  for (const d of feed) bySource[d.source] = (bySource[d.source] ?? 0) + 1;

  const regime: SignalBoardHeroRegime | null = inp.regimeLatest
    ? { label: inp.regimeLatest.regimeLabel, composite: inp.regimeLatest.composite, asOf: inp.regimeLatest.asOf, transition: !!inp.regimeLatest.transition }
    : null;

  return { generatedAt: inp.nowIso, regime, capstone: inp.capstone, feed, bySource };
}
