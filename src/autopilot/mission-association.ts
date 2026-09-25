// ── 미션 연관(association) 엣지 — 같은 코드영역 (E5 · 미션 생태계 RFC §4.1·§4.3 · 2026-07-18) ──
//
// 같은 서브시스템/파일을 건드리는 미션들을 association 엣지로 잇는다(무방향 의미·저장은 from→to).
// grounding(각 미션이 조사에서 touch 한 기존 파일) 교집합(Jaccard)이 임계 이상이면 연관. 이 엣지가
// E5 미션 간 공진화(연관 미션의 회고·변경스토리 학습 전파)와 E4 시각화의 근거가 된다.
//
// 안전: 관계 메타(집행 0·armed 아님). fail-soft(링킹 실패가 미션 준비를 막지 않음).

import type { Database } from 'bun:sqlite';
import { addMissionEdge } from './mission-edges.js';

/** 연관 임계 — grounding 파일 Jaccard 유사도(같은 코드영역 판정). 과연결(노이즈) 방지 보수값. */
export const ASSOCIATION_THRESHOLD = 0.25;

/** 두 파일 집합의 Jaccard 유사도(순수·0~1). 빈 집합이면 0. */
export function associationScore(a: readonly string[], b: readonly string[]): number {
  const sa = new Set(a.filter(Boolean));
  const sb = new Set(b.filter(Boolean));
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** 미션 description 의 "## 내부 grounding" 섹션에서 파일 경로를 추출(순수). se-mission-prepare 가
 *  grounding.files 를 "- <file>" 리스트로 저장한다(다음 ## 섹션 전까지). 없으면 []. */
export function parseGroundingFiles(description: string | null | undefined): string[] {
  if (!description) return [];
  const files: string[] = [];
  let inSection = false;
  for (const line of description.split('\n')) {
    if (line.startsWith('## 내부 grounding')) { inSection = true; continue; }
    if (inSection && line.startsWith('## ')) break;
    if (inSection && line.startsWith('- ')) files.push(line.slice(2).trim());
  }
  return files.filter(Boolean);
}

/** 이 미션(files)과 다른 미션들의 코드영역 교집합을 계산해 임계 이상이면 association 엣지를 잇는다.
 *  self 제외·빈 files 무시. addMissionEdge 는 fail-soft. 링크된 {toId,score} 목록 반환(관측·테스트). */
export function linkMissionAssociations(
  missionId: string, files: readonly string[],
  others: ReadonlyArray<{ id: string; files: readonly string[] }>,
  deps: { threshold?: number; edgeDb?: Database; now?: number } = {},
): Array<{ toId: string; score: number }> {
  const th = deps.threshold ?? ASSOCIATION_THRESHOLD;
  const linked: Array<{ toId: string; score: number }> = [];
  if (!missionId || !files.length) return linked;
  for (const o of others) {
    if (!o.id || o.id === missionId) continue;
    const score = associationScore(files, o.files);
    if (score >= th) {
      addMissionEdge(missionId, o.id, 'association', `코드영역 교집합(Jaccard ${score.toFixed(2)})`, {
        ...(deps.now !== undefined ? { now: deps.now } : {}),
        ...(deps.edgeDb ? { db: deps.edgeDb } : {}),
      });
      linked.push({ toId: o.id, score });
    }
  }
  return linked;
}
