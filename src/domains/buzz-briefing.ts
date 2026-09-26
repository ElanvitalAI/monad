// ── 온디맨드 커뮤니티 버즈 브리핑 (대표 지시 2026-07-15) ──────────────────────
//
// "역으로 브리핑해도 답을 받을 수 있는 구조" — P5 버즈 다이제스트는 push(예약)뿐이라 PULL 이
// 없었다. 이 모듈이 (1) 수집된 버즈 조회 + (2) stale(밤/주말/수집 정지 구간)이면 실시간 그랩
// 폴백을 순수 로직으로 제공한다. CLI(`elanous buzz`)가 실 fetch/parse/normalize 를 주입해 조립.
//
// 수집 주기: community-buzz-cycle = */10 8-20 KST 평일. 그 밖 = stale → 실시간 그랩이 답.

export interface BuzzFreshness {
  lastPostIso: string | null;
  ageMin: number | null;
  stale: boolean;
}

/** 마지막 수집 시각으로 신선도 판정 — staleMin(기본 30분) 초과면 stale(실시간 그랩 권장). */
export function assessFreshness(lastPostIso: string | null, nowMs: number, staleMin = 30): BuzzFreshness {
  if (!lastPostIso) return { lastPostIso: null, ageMin: null, stale: true };
  const ageMin = Math.round((nowMs - Date.parse(lastPostIso)) / 60_000);
  return { lastPostIso, ageMin, stale: !Number.isFinite(ageMin) || ageMin > staleMin };
}

export interface BuzzNarrative { narrative: string; count: number; sample?: string }
export interface HotPost { title: string; recommends: number; url: string }

/** 실시간 그랩 posts → 티커별 버즈 집계 + 인기글. normalizeFn 이 제목→티커 추출(주입). 순수. */
export function aggregateLiveBuzz(
  posts: Array<{ title: string; recommends?: number; url: string }>,
  normalizeFn: (title: string) => string[],
  limit = 10,
): { narratives: BuzzNarrative[]; hotPosts: HotPost[] } {
  const byTicker = new Map<string, { count: number; sample: string }>();
  for (const p of posts) {
    for (const t of normalizeFn(p.title)) {
      const cur = byTicker.get(t) ?? { count: 0, sample: p.title };
      cur.count += 1;
      byTicker.set(t, cur);
    }
  }
  const narratives = [...byTicker.entries()]
    .map(([narrative, v]) => ({ narrative, count: v.count, sample: v.sample }))
    .sort((a, b) => b.count - a.count).slice(0, limit);
  const hotPosts = [...posts]
    .sort((a, b) => (b.recommends ?? 0) - (a.recommends ?? 0)).slice(0, 8)
    .map((p) => ({ title: p.title, recommends: p.recommends ?? 0, url: p.url }));
  return { narratives, hotPosts };
}

export interface BuzzBriefing {
  mode: 'collected' | 'live';
  freshness: BuzzFreshness;
  narratives: BuzzNarrative[];
  hotPosts?: HotPost[];
}

/** 사람이 읽을 브리핑 문자열(순수). */
export function formatBuzzBriefing(b: BuzzBriefing): string {
  const fresh = b.freshness;
  const age = fresh.ageMin == null ? '수집 이력 없음' : `${fresh.ageMin}분 전`;
  const head = b.mode === 'live'
    ? `📣 커뮤니티 버즈 · 실시간 그랩 (수집 ${age}${fresh.stale ? '·stale' : ''} → 라이브)`
    : `📣 커뮤니티 버즈 · 수집분 (최신 ${age})`;
  const lines = [head, ''];
  if (b.narratives.length === 0) lines.push('(집계된 서사 없음)');
  b.narratives.forEach((n, i) => {
    const s = n.sample ? ` "${n.sample.slice(0, 60)}"` : '';
    lines.push(`${i + 1}. ${n.narrative} · ${n.count}건${s}`);
  });
  if (b.hotPosts?.length) {
    lines.push('', '🔥 인기글:');
    for (const h of b.hotPosts.slice(0, 6)) lines.push(`  · [${h.recommends}] ${h.title.slice(0, 60)}`);
  }
  lines.push('', '※ 커뮤니티 정성 신호 · 매매 아님.');
  return lines.join('\n');
}
