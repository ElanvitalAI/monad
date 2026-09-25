// 미션 빌드 파이프라인 — 프레임 저널 (P0·관측성 SoT)
//
// ★ 관측성: append-only JSONL(turn-checkpoint/store.ts 동형). 미션당 한 파일. 각 단계 실행이
//   프레임으로 남아 "무슨 인자로 무엇을 냈나"를 사후에 본다. debug.log 로 logs.db 에도 흘려
//   `monad logs --category mission.pipeline.frame` 조회. LLM 원문은 sidecar 분리(크기 리스크).
// fail-soft: 저널 write 실패가 빌드를 막지 않는다(관측은 부수효과).

import * as fs from 'node:fs';
import { join, dirname } from 'node:path';
import { monadStateRoot } from '../state-paths.js';
import { debug } from '../../debug/log.js';
import type { PipelineFrame, FrameLlmSidecar } from './frame-types.js';
import { missionGeneration } from '../lineage/mission-generation.js';

const DEFAULT_SUBDIR = 'conatus/pipeline_frames';
let overrideDir: string | null = null;

/** 테스트/픽스처용 디렉토리 오버라이드. null = 기본 복원. */
export function setFrameDir(dir: string | null): void { overrideDir = dir; }
export function frameDir(): string { return overrideDir ?? join(monadStateRoot(), DEFAULT_SUBDIR); }

/** 미션 id → 파일 안전 slug(빌드·실행 저널 공유). */
export function safeId(missionId: string): string {
  return (missionId || 'unknown').replace(/[^\w.-]/g, '_').slice(0, 80);
}

// ── S4 저수준 재사용(순수 IO·빌드 appendFrame 과 실행 exec-frame-journal 공유) ──────────────
/** append-only jsonl 한 줄 write(빌드/실행 프레임 공유·fail-soft 는 호출측). 디렉토리 자동 생성. */
export function appendJsonlLine(filePath: string, obj: unknown): void {
  fs.mkdirSync(dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(obj) + '\n', 'utf8');
}
/** jsonl 파싱(malformed 라인 skip — 한 줄 손상이 리플레이를 오염시키지 않는다). 검증기 통과분만. */
export function readJsonlLines<T>(filePath: string, isValid: (o: unknown) => o is T): T[] {
  let raw: string;
  try { raw = fs.readFileSync(filePath, 'utf8'); } catch { return []; }
  const out: T[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim(); if (!t) continue;
    try { const p = JSON.parse(t) as unknown; if (isValid(p)) out.push(p); } catch { /* malformed skip */ }
  }
  return out;
}
export function framePath(missionId: string): string {
  return join(frameDir(), `${safeId(missionId)}.jsonl`);
}
function sidecarPath(missionId: string, seq: number): string {
  return join(frameDir(), `${safeId(missionId)}.${seq}.llm.json`);
}

/** 미션 id + seq → 결정론 frameId. */
export function makeFrameId(missionId: string, seq: number): string {
  return `${safeId(missionId)}:${seq}`;
}

/** append-only 프레임 write(관측 계측). sidecar 있으면 LLM 원문 분리 저장. fail-soft. */
export function appendFrame(frame: PipelineFrame, sidecar?: { promptRaw: string; responseRaw: string }): void {
  try {
    // ★ H4 — 세대 스탬프(파티션). 미지정 시 write 시점 세대(memo·fail-soft). 옛 프레임은 undefined 유지.
    if (frame.generation === undefined) {
      try { frame.generation = missionGeneration(frame.missionId); } catch { /* fail-soft */ }
    }
    fs.mkdirSync(frameDir(), { recursive: true });
    fs.appendFileSync(framePath(frame.missionId), JSON.stringify(frame) + '\n', 'utf8');
    if (sidecar && frame.llm) {
      const sc: FrameLlmSidecar = {
        frameId: frame.frameId, model: frame.llm.model,
        promptRaw: sidecar.promptRaw, responseRaw: sidecar.responseRaw,
      };
      try { fs.writeFileSync(sidecarPath(frame.missionId, frame.seq), JSON.stringify(sc), 'utf8'); }
      catch { /* sidecar 실패는 프레임 자체를 막지 않는다 */ }
    }
    debug.log('mission.pipeline.frame', frame.op, {
      missionId: frame.missionId, seq: frame.seq, stage: frame.stage, status: frame.status,
      ...(frame.supersededBy !== undefined ? { supersededBy: frame.supersededBy } : {}),
    });
  } catch (err) {
    debug.log('mission.pipeline.frame', 'write-fail', {
      missionId: frame.missionId, error: err instanceof Error ? err.message : String(err),
    }, { level: 'error' });
  }
}

/** 저널 파싱(malformed 라인 skip — 한 줄 손상이 리플레이를 오염시키지 않는다). seq 순 정렬. */
export function readFrames(missionId: string): PipelineFrame[] {
  let raw: string;
  try { raw = fs.readFileSync(framePath(missionId), 'utf8'); } catch { return []; }
  const out: PipelineFrame[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim(); if (!t) continue;
    try {
      const p = JSON.parse(t) as PipelineFrame;
      if (p && typeof p === 'object' && p.missionId && p.stage && typeof p.seq === 'number') out.push(p);
    } catch { /* malformed skip */ }
  }
  return out.sort((a, b) => a.seq - b.seq);
}

/** 최신(마지막 seq) 프레임. 없으면 null. */
export function loadLatestFrame(missionId: string): PipelineFrame | null {
  const f = readFrames(missionId);
  return f.length ? f[f.length - 1]! : null;
}

/** 다음 seq(append 계측용) — 기존 최대 seq+1, 없으면 0. */
export function nextSeq(missionId: string): number {
  const f = readFrames(missionId);
  return f.length ? Math.max(...f.map((x) => x.seq)) + 1 : 0;
}

/** LLM sidecar 원문 lazy load(replay·"프롬프트 적절성" 자기인지). 없으면 null. */
export function readLlmSidecar(missionId: string, seq: number): FrameLlmSidecar | null {
  try { return JSON.parse(fs.readFileSync(sidecarPath(missionId, seq), 'utf8')) as FrameLlmSidecar; }
  catch { return null; }
}
