// 미션 빌드 파이프라인 — critique 관측 트레이스 (sol 입출력 sidecar)
//
// ★ 관측성·자기인지: critique(분해 비평)의 verdict 만 남던 갭을 수복. sol(LLM)이 받은 실존맵·프롬프트·
//   응답 원문을 페이즈별 sidecar 로 남겨 "sol 이 [실존] 실측 맵을 받고도 왜 ungrounded 냈나"를 사후에
//   직접 본다(오탐 진단의 열쇠). frame-journal 과 같은 디렉토리(pipeline_frames) 재사용. 원문은 크기
//   리스크로 sidecar 분리(트레이스엔 chars·실존맵 요약만). fail-soft(관측이 비평을 막지 않는다).

import * as fs from 'node:fs';
import { join } from 'node:path';
import { frameDir } from './frame-journal.js';
import { debug } from '../../debug/log.js';

function safeId(id: string): string { return (id || 'unknown').replace(/[^\w.-]/g, '_').slice(0, 80); }
function tracePath(missionId: string): string { return join(frameDir(), `${safeId(missionId)}.critique-trace.jsonl`); }
function sidecarPath(missionId: string, phaseId: string): string {
  return join(frameDir(), `${safeId(missionId)}.critique.${safeId(phaseId)}.json`);
}

/** 페이즈 비평 1건 메타(원문 제외) — verdict + 실존맵 요약 + dropped(CAP 초과 미검사) + grounding. */
export interface CritiqueTraceMeta {
  phaseId: string;
  title: string;
  verdict: string;
  severity: string;
  reuseMap: string;          // formatExistenceMap([실존]/[전무] 심볼·LLM 이 실제 받은 맵)
  existsCount: number;       // [실존] 판정 수
  total: number;             // 검사 토큰 수
  dropped: number;           // ★ CAP 초과로 미검사된 토큰 수(오탐 주범 후보)
  groundConfidence: string;
  model: string;             // ★ 실제 비평 모델(terra/sol/luna) — CLI 표시 정확성(라벨 하드코딩 버그 수복)
  runId: string;             // ★ 라운드 태그(한 critiquePhaseDecomposition=한 라운드) — 재분해 누적 격리
  override?: string;         // ★ ungrounded 결정론 오탐필터 적용됨(new-absent-legit=clear/reuse-exists=downgrade). 없으면 미적용.
  promptChars: number;
  responseChars: number;
  at: string;                // ISO8601(호출측 주입)
}

/** critique 트레이스 append + 원문 sidecar 분리 저장(있으면). fail-soft. */
export function appendCritiqueTrace(
  missionId: string, meta: CritiqueTraceMeta, raw?: { prompt: string; response: string },
): void {
  try {
    fs.mkdirSync(frameDir(), { recursive: true });
    fs.appendFileSync(tracePath(missionId), JSON.stringify(meta) + '\n', 'utf8');
    if (raw) {
      try { fs.writeFileSync(sidecarPath(missionId, meta.phaseId), JSON.stringify(raw), 'utf8'); }
      catch { /* sidecar 실패는 트레이스를 막지 않는다 */ }
    }
    debug.log('mission.decomp.critique.trace', meta.verdict, {
      missionId, phaseId: meta.phaseId, existsCount: meta.existsCount, total: meta.total, dropped: meta.dropped,
    });
  } catch (err) {
    debug.log('mission.decomp.critique.trace', 'write-fail', {
      missionId, error: err instanceof Error ? err.message : String(err),
    }, { level: 'error' });
  }
}

/** 트레이스 메타 목록(malformed skip). */
export function readCritiqueTraces(missionId: string): CritiqueTraceMeta[] {
  let raw: string;
  try { raw = fs.readFileSync(tracePath(missionId), 'utf8'); } catch { return []; }
  const out: CritiqueTraceMeta[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim(); if (!t) continue;
    try {
      const p = JSON.parse(t) as CritiqueTraceMeta;
      if (p && typeof p === 'object' && p.phaseId && p.verdict) out.push(p);
    } catch { /* malformed skip */ }
  }
  return out;
}

/** 페이즈 sol 입출력 원문 lazy load("왜 [실존] 무시했나" 진단). 없으면 null. */
export function readCritiqueSidecar(missionId: string, phaseId: string): { prompt: string; response: string } | null {
  try { return JSON.parse(fs.readFileSync(sidecarPath(missionId, phaseId), 'utf8')) as { prompt: string; response: string }; }
  catch { return null; }
}
