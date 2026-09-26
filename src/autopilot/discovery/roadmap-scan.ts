// ── Self-Evolution SE1 · 미구현 로드맵 스캐너 (내부 발굴 · 1순위 · 2026-07-09) ──
//
// 대표: "elanous도 플랜을 많이 세워놓고 구현 못 한 게 많다. 이것이 우선순위다."
// SE0 doc-inventory(scanDocs) 결과에서 PLAN/ROADMAP 미완을 골라 우선순위 재산정.
// 발굴 1순위(외부 repo diff 는 2순위). 출력 = SE2 제안 큐 입력.
//
// 순수 랭킹 로직 + self_recall 교차(주입) — "이미 구현됐는데 문서가 [ ]인" 유령 제외.

import { kindOfPrefix, staleScore, type DocEntry } from './doc-inventory.js';

export interface UnimplementedPlan {
  path: string;
  filename: string;
  topic: string;
  date: string | null;
  openBoxes: number;
  doneBoxes: number;
  completionRatio: number;   // done/(open+done)
  staleScore: number;
  priorityScore: number;     // 재산정 우선순위(높을수록 부활 유력)
  reasons: string[];         // 우선순위 근거
}

export interface RoadmapScanOpts {
  nowMs: number;
  /** 최소 미완 체크박스(노이즈 컷·기본 3). */
  minOpen?: number;
  /** 우선 주제 키워드(대표 north-star·⭐) — 매치 시 가산. */
  priorityTopics?: string[];
  /** deprioritize 키워드(터미널 GUI·voice 등) — 매치 시 감점. */
  deprioritizeTopics?: string[];
}

const DEFAULT_PRIORITY = ['autopilot', 'self-evolution', 'memory', 'scheduler', 'regime', 'loop', 'backtest', 'conatus', 'signal'];
const DEFAULT_DEPRIORITIZE = ['tui', 'voice', 'terminal', 'ime', 'swiftterm', 'border-animation', 'presentation'];

/** 미완 로드맵 우선순위 재산정 — 미완량 + 최신성 + north-star 근접 - stale - deprioritize.
 *  큰 미완(로드맵 규모) + 최근 + 대표 우선주제 = 부활 유력. 오래된 deprioritized = 하락. */
export function rankUnimplemented(entries: DocEntry[], opts: RoadmapScanOpts): UnimplementedPlan[] {
  const minOpen = opts.minOpen ?? 3;
  const prio = opts.priorityTopics ?? DEFAULT_PRIORITY;
  const deprio = opts.deprioritizeTopics ?? DEFAULT_DEPRIORITIZE;

  const plans = entries.filter(e => {
    const k = kindOfPrefix(e.prefix);
    return (k === 'plan' || k === 'roadmap') && e.openBoxes >= minOpen;
  });

  const ranked = plans.map(e => {
    const total = e.openBoxes + e.doneBoxes;
    const completionRatio = total > 0 ? e.doneBoxes / total : 0;
    const stale = staleScore(e, opts.nowMs);
    const reasons: string[] = [];
    let score = 0;

    // 미완 규모(로그 포화 — 큰 로드맵일수록↑, 과도하진 않게).
    const openW = Math.min(40, Math.round(Math.log1p(e.openBoxes) * 12));
    score += openW; reasons.push(`미완 ${e.openBoxes}개(+${openW})`);

    // 최신성(최근 문서 = 살아있는 의도).
    if (e.date) {
      const ageDays = Math.max(0, (opts.nowMs - Date.parse(e.date)) / 86400_000);
      const recW = Math.max(0, Math.round(30 - ageDays / 3)); // ~90일이면 0
      score += recW; if (recW > 0) reasons.push(`최근(+${recW})`);
    }

    // north-star 근접(대표 우선주제).
    const topicL = e.topic.toLowerCase();
    if (prio.some(p => topicL.includes(p))) { score += 25; reasons.push('north-star 주제(+25)'); }

    // 착수됐으나 미완(완료율 0<r<1 = 진행하다 멈춤 = 부활 쉬움).
    if (completionRatio > 0 && completionRatio < 1) { score += 15; reasons.push(`부분 진행 ${Math.round(completionRatio * 100)}%(+15)`); }

    // stale 감점.
    score -= Math.round(stale * 0.3); if (stale >= 45) reasons.push(`stale ${stale}(-${Math.round(stale * 0.3)})`);

    // deprioritize 감점(터미널 GUI/voice 등 · 대표 우선순위 아님).
    if (deprio.some(d => topicL.includes(d))) { score -= 40; reasons.push('deprioritized 주제(-40)'); }

    return {
      path: e.path, filename: e.filename, topic: e.topic, date: e.date,
      openBoxes: e.openBoxes, doneBoxes: e.doneBoxes,
      completionRatio: Math.round(completionRatio * 100) / 100,
      staleScore: stale, priorityScore: score, reasons,
    };
  });

  return ranked.sort((a, b) => b.priorityScore - a.priorityScore);
}

/** self_recall 교차 강한-매치 카운터 — 주제의 **모든 토큰이 한 이벤트에 동시 등장(AND)**
 *  하는 것만 "그 주제를 실제 구현/수행한 증거"로 카운트. surface_events FTS 는 토큰 OR
 *  매칭이라(흔한 토큰 'loop'·'signal' 이 수백 이벤트에 걸림) 그대로 세면 대량 오탐 →
 *  이 후처리로 정밀도 확보. events = recallEvents 결과(summary/text 를 가진 행). */
export function countStrongTopicMatches(
  events: Array<{ summary?: string | null; text?: string | null }>,
  topic: string,
): number {
  const tokens = topic.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  if (!tokens.length) return 0;
  return events.filter(e => {
    const hay = `${e.summary ?? ''} ${e.text ?? ''}`.toLowerCase();
    return tokens.every(t => hay.includes(t));
  }).length;
}

/** self_recall 교차 — "이미 구현됐는데 문서가 미완인" 유령 제거(주입 recall).
 *  recall(topic) 이 최근 impl 이벤트를 반환하면 이미 구현 가능성 → 후보에서 강등.
 *  recall 미주입이면 원본 그대로(fail-open). */
export async function filterAlreadyImplemented(
  plans: UnimplementedPlan[],
  recall?: (query: string) => Promise<{ hits: number }>,
): Promise<{ live: UnimplementedPlan[]; likelyDone: UnimplementedPlan[] }> {
  if (!recall) return { live: plans, likelyDone: [] };
  const live: UnimplementedPlan[] = [];
  const likelyDone: UnimplementedPlan[] = [];
  for (const p of plans) {
    try {
      const r = await recall(p.topic.replace(/-/g, ' '));
      // 구현 이벤트가 여럿이면 이미 구현됐을 개연성(문서 [ ]는 갱신 안 된 것).
      if (r.hits >= 3) likelyDone.push(p); else live.push(p);
    } catch { live.push(p); }
  }
  return { live, likelyDone };
}

/** 발굴 리포트(상위 N · SE2 제안 입력용 markdown). */
export function renderUnimplementedReport(plans: UnimplementedPlan[], limit = 15): string {
  const top = plans.slice(0, limit);
  const L = [`# 미구현 로드맵 발굴 (내부 · SE1 · 상위 ${top.length})`, ''];
  L.push('| # | 문서 | 미완 | 완료율 | 우선점수 | 근거 |');
  L.push('|--:|---|--:|--:|--:|---|');
  top.forEach((p, i) => {
    L.push(`| ${i + 1} | ${p.filename} | ${p.openBoxes} | ${Math.round(p.completionRatio * 100)}% | ${p.priorityScore} | ${p.reasons.join(' · ')} |`);
  });
  return L.join('\n');
}
