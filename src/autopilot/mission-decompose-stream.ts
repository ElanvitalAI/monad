// ── 분해 스트리밍 실시간 관측 (대표 2026-07-17) ─────────────────────────────────
// decompose(sol 리즈닝)는 수 분간 블랙박스였다(streamLLM 콜백을 버림). sol 출력을 미션별 임시
// 파일에 실시간 append 해 "지금 뭘 분해하는지"를 진행 중에도 조회 가능하게 한다(접근성=파일 + CLI).
// research 딥리서치 아카이브·decompose_crash.log 패턴 동형. 분해 시작 시 초기화·완료/실패 후 유지(진단).

import { join, dirname } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, statSync } from 'node:fs';
import { monadStateRoot } from './state-paths.js';

/** 미션별 분해 스트림 파일 경로. */
export function decomposeStreamPath(missionId: string): string {
  const safe = (missionId || 'unknown').replace(/[^\w.-]/g, '_').slice(0, 80);
  return join(monadStateRoot(), 'conatus/decompose_stream', `${safe}.log`);
}

/** 분해 시작 시 초기화(재분해마다 새로). 헤더에 시각·모델 기록. fail-soft. */
export function startDecomposeStream(missionId: string, meta: { model: string; at?: string }): void {
  try {
    const p = decomposeStreamPath(missionId);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, `# decompose stream · ${missionId} · model=${meta.model} · start=${meta.at ?? '(now)'}\n\n`);
  } catch { /* fail-soft */ }
}

/** sol 출력 증분(delta)을 실시간 append. streamLLM 콜백에서 호출. fail-soft(관측이 분해를 막지 않음). */
export function appendDecomposeStream(missionId: string, delta: string): void {
  if (!delta) return;
  try { appendFileSync(decomposeStreamPath(missionId), delta); } catch { /* fail-soft */ }
}

export interface DecomposeStreamRead { exists: boolean; chars: number; mtime?: string; content: string }

/** 스트림 파일 조회 — 없으면 exists:false. tail=마지막 N자(기본 전체). */
export function readDecomposeStream(missionId: string, opts: { tailChars?: number } = {}): DecomposeStreamRead {
  const p = decomposeStreamPath(missionId);
  if (!existsSync(p)) return { exists: false, chars: 0, content: '' };
  try {
    const raw = readFileSync(p, 'utf-8');
    const content = opts.tailChars && raw.length > opts.tailChars ? `…(앞 ${raw.length - opts.tailChars}자 생략)\n${raw.slice(-opts.tailChars)}` : raw;
    return { exists: true, chars: raw.length, mtime: statSync(p).mtime.toISOString(), content };
  } catch { return { exists: false, chars: 0, content: '' }; }
}
