// 미션 실행 페이즈 프레임 저널 (S4·실행 적응 2026-07-19)
//
// ★ 저수준 재사용(대표 결정 2026-07-19) — jsonl append/read·safeId·frameDir 는 frame-journal.ts 것을
//   그대로 쓰고, 타입(ExecutionFrame)과 파일(<id>.exec.jsonl)만 분리한다. 빌드 PipelineFrame 무변경.
// ★ 관측: append 마다 debug.log('mission.exec.frame') 로 logs.db 에도 흘려 `monad logs` 조회. fail-soft.

import { join } from 'node:path';
import { frameDir, safeId, appendJsonlLine, readJsonlLines } from './frame-journal.js';
import { missionGeneration } from '../lineage/mission-generation.js';
import { debug } from '../../debug/log.js';
import type { ExecutionFrame, ExecFrameOp, ExecPhaseStatus } from './exec-frame-types.js';
import type { DeviationKind } from '../mission-working-memory.js';

/** 실행 저널 파일 경로 — 빌드(<id>.jsonl)와 분리(<id>.exec.jsonl·같은 디렉토리). */
export function execFramePath(missionId: string): string {
  return join(frameDir(), `${safeId(missionId)}.exec.jsonl`);
}

/** 미션 id + seq → 결정론 실행 frameId('exec' 네임스페이스로 빌드 frameId 와 충돌 방지). */
export function makeExecFrameId(missionId: string, seq: number): string {
  return `${safeId(missionId)}:exec:${seq}`;
}

/** 최소 구조 검증(malformed·빌드 프레임 혼입 방지) — exec 필수 필드만 확인. */
function isExecFrame(o: unknown): o is ExecutionFrame {
  if (!o || typeof o !== 'object') return false;
  const f = o as Record<string, unknown>;
  return typeof f.missionId === 'string' && typeof f.seq === 'number'
    && typeof f.phaseId === 'string' && typeof f.op === 'string' && typeof f.status === 'string';
}

/** 실행 저널 파싱(malformed skip·seq 순 정렬). */
export function readExecFrames(missionId: string): ExecutionFrame[] {
  return readJsonlLines(execFramePath(missionId), isExecFrame).sort((a, b) => a.seq - b.seq);
}

/** 다음 seq(append 계측용) — 기존 최대 seq+1, 없으면 0. */
export function nextExecSeq(missionId: string): number {
  const f = readExecFrames(missionId);
  return f.length ? Math.max(...f.map((x) => x.seq)) + 1 : 0;
}

/** 최신(마지막 seq) 실행 프레임. 없으면 null. */
export function loadLatestExecFrame(missionId: string): ExecutionFrame | null {
  const f = readExecFrames(missionId);
  return f.length ? f[f.length - 1]! : null;
}

/** append-only 실행 프레임 write(관측 계측). fail-soft — 저널 실패가 실행을 막지 않는다. */
export function appendExecFrame(frame: ExecutionFrame): void {
  try {
    // ★ H4 — 세대 스탬프(파티션). 미지정 시 write 시점 세대(memo·fail-soft). 옛 프레임은 undefined 유지.
    if (frame.generation === undefined) {
      try { frame.generation = missionGeneration(frame.missionId); } catch { /* fail-soft */ }
    }
    appendJsonlLine(execFramePath(frame.missionId), frame);
    debug.log('mission.exec.frame', frame.op, {
      missionId: frame.missionId, seq: frame.seq, phaseId: frame.phaseId, status: frame.status,
      ...(frame.framework ? { framework: frame.framework } : {}),
      // ★ 실시간 관측(대표 2026-07-19) — 어느 아크의 페이즈인지 로그에서 바로 보이게(arcId 해시가 아니라
      //   사람이 읽는 arcSeq/arcName). `monad logs --category mission.exec.frame` 로 아크 진행을 와칭.
      ...(frame.arcSeq ? { arcSeq: frame.arcSeq } : {}),
      ...(frame.arcName ? { arcName: frame.arcName } : {}),
      ...(frame.arcId ? { arcId: frame.arcId } : {}),
      ...(frame.deviation ? { deviation: frame.deviation.kind } : {}),
    });
  } catch (err) {
    debug.log('mission.exec.frame', 'write-fail', {
      missionId: frame.missionId, error: err instanceof Error ? err.message : String(err),
    }, { level: 'error' });
  }
}

/** ★ put_writes (조율자 격상 P0·2026-07-19) — 페이즈가 durable 산출물을 낸 "그 순간" pending-write 프레임을
 *  남긴다(phase-done 전 크래시에도 원장 보존 = 고아 차단). LangGraph BaseCheckpointSaver.put_writes 이식:
 *  중간 write 를 task(=phaseId) 키로 저장해 재개가 잃지도·재실행하지도 않게 한다. seq/frameId/timestamp
 *  자동·fail-soft. 정상 완주 시 뒤이어 오는 phase-done 프레임이 이 페이즈를 consolidate(=collectPendingWrites
 *  에서 제외)한다. */
export function recordPendingWrite(
  missionId: string,
  entry: {
    phaseId: string; phaseTitle: string;
    artifacts: string[];  // ★ 보존할 durable write(PR URL·브랜치·커밋). 최소 1개.
    framework?: 'se-isolated' | 'walker';
    arcId?: string; arcName?: string; arcSeq?: string;
    note?: string;
  },
): void {
  recordExecPhase(missionId, {
    phaseId: entry.phaseId, phaseTitle: entry.phaseTitle,
    op: 'pending-write', status: 'running',
    ...(entry.framework ? { framework: entry.framework } : {}),
    ...(entry.arcId ? { arcId: entry.arcId } : {}),
    ...(entry.arcName ? { arcName: entry.arcName } : {}),
    ...(entry.arcSeq ? { arcSeq: entry.arcSeq } : {}),
    artifacts: entry.artifacts,
    ...(entry.note ? { note: entry.note } : {}),
  });
}

/** ★ 미consolidated pending-write 회수(재개·고아 방지) — pending-write 프레임 중, 같은 phaseId 에 대해
 *  이후 seq 에 terminal 프레임(phase-done/skip 의 done|skipped|no-op)이 없는 것만 반환. 즉 "산출물은 냈으나
 *  정상 종결 프레임이 안 남은" 고아 후보다. 재개한 run-mission·조율자가 이걸 보고 재구현을 건너뛴다.
 *  결정론·순수 조회(READ-ONLY). phaseId 지정 시 그 페이즈만. */
export function collectPendingWrites(
  missionId: string, opts: { phaseId?: string } = {},
): Array<{ phaseId: string; phaseTitle: string; artifacts: string[]; seq: number; arcName?: string }> {
  const frames = readExecFrames(missionId);
  // 각 phaseId 의 마지막 terminal(정상 종결) seq — 이보다 앞선 pending-write 는 consolidate 됨.
  const terminalSeq = new Map<string, number>();
  for (const f of frames) {
    const terminal = (f.op === 'phase-done' && (f.status === 'done' || f.status === 'no-op'))
      || (f.op === 'skip' && f.status === 'skipped');
    if (terminal && f.phaseId) {
      const prev = terminalSeq.get(f.phaseId);
      if (prev === undefined || f.seq > prev) terminalSeq.set(f.phaseId, f.seq);
    }
  }
  // phaseId 별로 최신 pending-write 1건만(같은 페이즈 여러 write 는 artifacts 누적) — 고아 후보 집계.
  const orphans = new Map<string, { phaseId: string; phaseTitle: string; artifacts: string[]; seq: number; arcName?: string }>();
  for (const f of frames) {
    if (f.op !== 'pending-write') continue;
    if (opts.phaseId && f.phaseId !== opts.phaseId) continue;
    const consolidated = (terminalSeq.get(f.phaseId) ?? -1) > f.seq;
    if (consolidated) { orphans.delete(f.phaseId); continue; }  // 이후 정상 종결됨 → 고아 아님
    const arts = f.artifacts ?? [];
    const cur = orphans.get(f.phaseId);
    orphans.set(f.phaseId, {
      phaseId: f.phaseId, phaseTitle: f.phaseTitle, seq: f.seq,
      artifacts: [...new Set([...(cur?.artifacts ?? []), ...arts])],
      ...(f.arcName ? { arcName: f.arcName } : {}),
    });
  }
  return [...orphans.values()].sort((a, b) => a.seq - b.seq);
}

/** ★ 고수준 편의 — 실행 페이즈 1건을 프레임으로 기록(seq·frameId·timestamp·version 자동). run-mission·
 *  시나리오 배선이 이 한 줄로 관측·리플레이 프레임을 남긴다. fail-soft(내부 append 가 이미 fail-soft). */
export function recordExecPhase(
  missionId: string,
  entry: {
    phaseId: string; phaseTitle: string; op: ExecFrameOp; status: ExecPhaseStatus;
    framework?: 'se-isolated' | 'walker';
    arcId?: string;
    arcName?: string;   // ★ 실시간 관측(대표 2026-07-19) — 사람이 읽는 아크 지칭
    arcSeq?: string;    //    "k/N" 순번(멀티아크만)
    deviation?: { kind: DeviationKind; note: string };
    artifacts?: string[];
    note?: string;
  },
): void {
  const seq = nextExecSeq(missionId);
  appendExecFrame({
    frameId: makeExecFrameId(missionId, seq),
    missionId, seq,
    phaseId: entry.phaseId, phaseTitle: entry.phaseTitle,
    op: entry.op, status: entry.status,
    timestamp: new Date().toISOString(), version: 0,
    ...(entry.framework ? { framework: entry.framework } : {}),
    ...(entry.arcId ? { arcId: entry.arcId } : {}),
    ...(entry.arcName ? { arcName: entry.arcName } : {}),
    ...(entry.arcSeq ? { arcSeq: entry.arcSeq } : {}),
    ...(entry.deviation ? { deviation: entry.deviation } : {}),
    ...(entry.artifacts && entry.artifacts.length ? { artifacts: entry.artifacts } : {}),
    ...(entry.note ? { note: entry.note } : {}),
  });
}
