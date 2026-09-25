// ── Self-Evolution SE0 · 문서 종합맵 렌더러 (2026-07-09) ───────────────────
//
// scanDocs(doc-inventory) 결과 → 성격 포함 종합맵 markdown. 대표: "문서 성격 포함한
// 종합맵이 필요". 실제 통합/삭제 전, 지반을 한눈에 본다(일주일 정리 계획의 입력).

import { kindOfPrefix, staleScore, indexGaps, type DocEntry, type DocKind, type IndexGap } from './doc-inventory.js';

function kb(bytes: number): string { return `${(bytes / 1024).toFixed(0)}KB`; }

function groupBy<T, K extends string>(xs: T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of xs) { const k = key(x); (m.get(k) ?? m.set(k, []).get(k)!).push(x); }
  return m;
}

const KIND_LABEL: Record<DocKind, string> = {
  plan: '계획(PLAN/ROADMAP/BACKLOG)', roadmap: '로드맵', research: '연구(RESEARCH)',
  handoff: '세션 핸드오프(HANDOFF)', recap: '세션 요약(RECAP)', reference: '레퍼런스(MANUAL/CAPABILITIES)',
  report: '보고(REPORT/AUDIT)', other: '기타',
};

export interface DocMapOpts {
  nowMs: number;
  totalAllMd?: number;
  dateLabel?: string;            // 맵 생성일(제목·파일명). 미지정 시 nowMs 에서 파생.
  indexLinks?: Set<string>;      // _index.md 링크 집합 — 주면 §7 미등록 갭 렌더.
  gapSinceDate?: string;         // 미등록 갭 최근 기준일(기본 dateLabel-14d 대신 명시).
}

/** 종합맵 markdown 생성. entries = scanDocs 결과(정리 대상 제외 스캔). */
export function buildDocMap(entries: DocEntry[], opts: DocMapOpts): string {
  const { nowMs } = opts;
  const dateLabel = opts.dateLabel ?? new Date(nowMs).toISOString().slice(0, 10);
  const withStale = entries.map(e => ({ ...e, stale: staleScore(e, nowMs) }));
  const totalSize = entries.reduce((s, e) => s + e.sizeBytes, 0);
  const L: string[] = [];

  L.push(`# MAP · docs/ 문서 종합맵 (성격 포함 · ${dateLabel})`);
  L.push('');
  L.push('> Self-Evolution SE0 자동 생성(src/autopilot/discovery/doc-map.ts). 실제 통합/삭제');
  L.push('> 전 지반 파악용. 실제 정리는 별도 일주일 계획으로(이 맵이 입력). READ-ONLY 스캔.');
  L.push('');
  L.push(`- 스캔 문서: **${entries.length}개** · 총 ${kb(totalSize)}${opts.totalAllMd ? ` · 전체 트리 ${opts.totalAllMd}개(아카이브 포함)` : ''}`);
  L.push('');

  // §1 성격별(kind) 요약
  L.push('## 1. 성격별 분포');
  L.push('');
  L.push('| 성격 | 문서 수 | 총 크기 | 미완 체크박스 | 날짜 범위 |');
  L.push('|---|--:|--:|--:|---|');
  const byKind = groupBy(withStale, e => kindOfPrefix(e.prefix));
  const kindOrder: DocKind[] = ['plan', 'roadmap', 'research', 'reference', 'report', 'handoff', 'recap', 'other'];
  for (const k of kindOrder) {
    const g = byKind.get(k);
    if (!g || !g.length) continue;
    const size = g.reduce((s, e) => s + e.sizeBytes, 0);
    const openTot = g.reduce((s, e) => s + e.openBoxes, 0);
    const dates = g.map(e => e.date).filter((d): d is string => !!d).sort();
    const range = dates.length ? `${dates[0]} ~ ${dates[dates.length - 1]}` : '-';
    L.push(`| ${KIND_LABEL[k]} | ${g.length} | ${kb(size)} | ${openTot} | ${range} |`);
  }
  L.push('');

  // §2 주제 클러스터 top (topic별 3+ 문서 = 해상도 과잉 후보)
  L.push('## 2. 주제 클러스터 (3개 이상 = 해상도 과잉/통합 후보)');
  L.push('');
  const byTopic = groupBy(withStale, e => e.topic);
  const clusters = [...byTopic.entries()].map(([topic, g]) => ({ topic, g, size: g.reduce((s, e) => s + e.sizeBytes, 0) }))
    .filter(c => c.g.length >= 3)
    .sort((a, b) => b.g.length - a.g.length)
    .slice(0, 30);
  L.push('| 주제 | 문서 수 | 크기 | 성격 구성 |');
  L.push('|---|--:|--:|---|');
  for (const c of clusters) {
    const kinds = [...new Set(c.g.map(e => e.prefix))].join('·');
    L.push(`| ${c.topic} | ${c.g.length} | ${kb(c.size)} | ${kinds} |`);
  }
  L.push('');

  // §3 미구현 로드맵 (PLAN/ROADMAP · openBoxes>0)
  L.push('## 3. 미구현 로드맵 (PLAN/ROADMAP · 미완 체크박스 순 · SE1 발굴 1순위)');
  L.push('');
  const unimpl = withStale
    .filter(e => (kindOfPrefix(e.prefix) === 'plan' || kindOfPrefix(e.prefix) === 'roadmap') && e.openBoxes >= 3)
    .sort((a, b) => b.openBoxes - a.openBoxes)
    .slice(0, 40);
  L.push('| 문서 | 미완 | 완료 | 날짜 | stale |');
  L.push('|---|--:|--:|---|--:|');
  for (const e of unimpl) L.push(`| ${e.filename} | ${e.openBoxes} | ${e.doneBoxes} | ${e.date ?? '-'} | ${e.stale} |`);
  L.push('');

  // §4 stale 정리 후보 (staleScore 높은 순 · plan/research 위주 = 실질 정리 대상)
  L.push('## 4. 정리 후보 (stale 점수 높은 순 · handoff/recap 제외 = 실질 통합/폐기 대상)');
  L.push('');
  const staleCandidates = withStale
    .filter(e => kindOfPrefix(e.prefix) !== 'handoff' && kindOfPrefix(e.prefix) !== 'recap')
    .filter(e => e.stale >= 45)
    .sort((a, b) => b.stale - a.stale)
    .slice(0, 40);
  L.push('| 문서 | stale | 크기 | 미완 | 날짜 |');
  L.push('|---|--:|--:|--:|---|');
  for (const e of staleCandidates) L.push(`| ${e.filename} | ${e.stale} | ${kb(e.sizeBytes)} | ${e.openBoxes} | ${e.date ?? '-'} |`);
  L.push('');

  // §5 서브디렉토리 분포
  L.push('## 5. 위치 분포');
  L.push('');
  const bySub = groupBy(withStale, e => (e.subdir || '(root)') as string);
  L.push('| 위치 | 문서 수 | 크기 |');
  L.push('|---|--:|--:|');
  for (const [sub, g] of [...bySub.entries()].sort((a, b) => b[1].length - a[1].length)) {
    L.push(`| ${sub} | ${g.length} | ${kb(g.reduce((s, e) => s + e.sizeBytes, 0))} |`);
  }
  L.push('');

  // 정리 권고 (제안만 · 실제 이동 HITL)
  L.push('## 6. 정리 권고 (제안 · 실제 이동/삭제는 HITL·일주일 계획)');
  L.push('');
  const handoffCount = byKind.get('handoff')?.length ?? 0;
  const recapCount = byKind.get('recap')?.length ?? 0;
  L.push(`- **세션 이력 색인화**: HANDOFF ${handoffCount} + RECAP ${recapCount} = ${handoffCount + recapCount}개 → 월별 INDEX-*.md 로 접고 원본은 _archive/ 이관 후보(내용 손실 없음).`);
  L.push(`- **주제 통합**: §2 클러스터 3+ 문서군은 최신 1개만 canonical, 나머지 _superseded/ 이관 후보.`);
  L.push(`- **stale 정리**: §4 고득점 문서(특히 오래된 미완 PLAN·terminal GUI/voice 계열)는 BACKLOG 재분류 또는 _archive/.`);
  L.push(`- **미구현 부활**: §3 미완 로드맵은 SE1 발굴기가 우선순위 재산정 → SE2 제안 큐.`);
  L.push('');

  // §7 trailhead(_index.md) 미등록 최근 문서 — 대표 "문서 많이 생겨 맵 재생성" 대응(누락 보강 후보).
  if (opts.indexLinks) {
    const sinceDate = opts.gapSinceDate ?? new Date(nowMs - 14 * 86400_000).toISOString().slice(0, 10);
    const gaps: IndexGap[] = indexGaps(entries, opts.indexLinks, { sinceDate });
    L.push(`## 7. trailhead 미등록 최근 문서 (${sinceDate}~ · _index.md 누락 보강 후보)`);
    L.push('');
    if (!gaps.length) {
      L.push(`- (없음) — ${sinceDate} 이후 생성된 trailhead 가치 문서는 모두 _index.md 에 등록됨.`);
    } else {
      L.push('| 문서 | 성격 | 날짜 | 미완 |');
      L.push('|---|---|---|--:|');
      for (const g of gaps) L.push(`| ${g.path} | ${g.prefix} | ${g.date ?? '-'} | ${g.openBoxes} |`);
      L.push('');
      L.push(`> ${gaps.length}개 미등록. _index.md Start Here/Active 섹션에 최신 핸드오프·FEATURE 추가 검토(큐레이션 보존·오래된 항목은 그대로).`);
    }
    L.push('');
  }

  L.push('*자동 생성 · 실제 파일 이동/삭제 없음(READ-ONLY 스캔). 링크 깨짐 방지 위해 정리는 계획 후 일괄.*');
  return L.join('\n');
}
