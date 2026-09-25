// 미션 빌드 파이프라인 — clarify 관측 트레이스 (sol 입출력 sidecar)
//
// ★ 관측성·자기인지: Intake clarify(범위/아크 모호도 판정)의 count/kinds 만 남던 갭을 수복. sol(LLM)이
//   받은 프롬프트·응답 원문을 phase(scope/arc)별 sidecar 로 남겨 "sol 이 왜 범위 0개(clear)로 판정했나"
//   를 사후에 직접 본다(비결정성 진단). critique-trace 와 동형·같은 디렉토리(pipeline_frames) 재사용.
//   원문은 sidecar 분리(트레이스엔 chars·kinds 만). fail-soft(관측이 clarify 를 막지 않는다).

import * as fs from 'node:fs';
import { join } from 'node:path';
import { frameDir } from './frame-journal.js';
import { debug } from '../../debug/log.js';

function safeId(id: string): string { return (id || 'unknown').replace(/[^\w.-]/g, '_').slice(0, 80); }
function tracePath(missionId: string): string { return join(frameDir(), `${safeId(missionId)}.clarify-trace.jsonl`); }
function sidecarPath(missionId: string, phase: string): string {
  return join(frameDir(), `${safeId(missionId)}.clarify.${safeId(phase)}.json`);
}

/** clarify 판정 1건 메타(원문 제외) — phase(scope/arc) + 생성 질문 수/종류 + fallback 여부. */
export interface ClarifyTraceMeta {
  phase: string;             // scope | arc | all
  count: number;             // 생성된 질문 수(0=clear)
  kinds: string[];           // scope/arc/term/safety
  heavy: boolean;
  fallback: boolean;         // ★ A 강제 fallback 로 주입됐나(LLM 0개 → 기본 범위 카드)
  promptChars: number;
  responseChars: number;
  at: string;                // ISO8601(호출측 주입)
}

/** clarify 트레이스 append + 원문 sidecar 분리 저장(있으면). phase 별 sidecar(scope/arc 각 1). fail-soft. */
export function appendClarifyTrace(
  missionId: string, meta: ClarifyTraceMeta, raw?: { prompt: string; response: string },
): void {
  try {
    fs.mkdirSync(frameDir(), { recursive: true });
    fs.appendFileSync(tracePath(missionId), JSON.stringify(meta) + '\n', 'utf8');
    if (raw) {
      try { fs.writeFileSync(sidecarPath(missionId, meta.phase), JSON.stringify(raw), 'utf8'); }
      catch { /* sidecar 실패는 트레이스를 막지 않는다 */ }
    }
    debug.log('mission.intake.trace', meta.count ? 'clarify' : 'clear', {
      missionId, phase: meta.phase, count: meta.count, kinds: meta.kinds, fallback: meta.fallback,
    });
  } catch (err) {
    debug.log('mission.intake.trace', 'write-fail', {
      missionId, error: err instanceof Error ? err.message : String(err),
    }, { level: 'error' });
  }
}

/** 트레이스 메타 목록(malformed skip). */
export function readClarifyTraces(missionId: string): ClarifyTraceMeta[] {
  let raw: string;
  try { raw = fs.readFileSync(tracePath(missionId), 'utf8'); } catch { return []; }
  const out: ClarifyTraceMeta[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim(); if (!t) continue;
    try {
      const p = JSON.parse(t) as ClarifyTraceMeta;
      if (p && typeof p === 'object' && p.phase && typeof p.count === 'number') out.push(p);
    } catch { /* malformed skip */ }
  }
  return out;
}

/** phase(scope/arc) sol 입출력 원문 lazy load("왜 범위 0개인가" 진단). 없으면 null. */
export function readClarifySidecar(missionId: string, phase: string): { prompt: string; response: string } | null {
  try { return JSON.parse(fs.readFileSync(sidecarPath(missionId, phase), 'utf8')) as { prompt: string; response: string }; }
  catch { return null; }
}
