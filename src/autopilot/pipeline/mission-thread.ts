// 미션 단일 thread 통합 리더 — build↔exec 저널 통합 (조율자 격상 P0·조각 2/3)
//
// ★ RFC P0(체크포인터 승격)의 "build↔exec 저널 통합(단일 thread)". 물리 병합이 아니라 LangGraph
//   subgraph checkpoint_ns 모델을 따른다: 두 저널(<id>.jsonl=build·<id>.exec.jsonl=exec)은 이미 같은
//   thread_id(missionId)의 두 네임스페이스다(exec 분리는 대표 결정 2026-07-19·BuildStage/Blackboard
//   강결합 격리). 이 리더가 둘을 layer 태그로 정규화·시간순 병합해 조율자에게 "미션 전체를 하나의
//   thread"로 보여준다(RFC ①전컨텍스트·②단일관측). 두 저널 타입/파일은 무변경.
// 전부 순수 조회(READ-ONLY·결정론). I/O 는 저수준 저널 read 뿐.

import { readFrames } from './frame-journal.js';
import { readExecFrames, collectPendingWrites } from './exec-frame-journal.js';
import { computeChannelVersions, type ChannelVersions } from './channel-versions.js';

/** thread 네임스페이스(checkpoint_ns) — build(분해 파이프라인)·exec(실행 페이즈). 향후 subgraph 확장 여지. */
export type ThreadLayer = 'build' | 'exec';

/** 정규화된 thread 엔트리 — build PipelineFrame·exec ExecutionFrame 공통 단면(단일 타임라인의 한 칸). */
export interface ThreadEntry {
  layer: ThreadLayer;
  seq: number;               // 해당 layer 내 단조 seq(layer 간 병합은 timestamp 순)
  timestamp: string;         // ISO8601 — 단일 thread 정렬 키
  label: string;             // build=stage · exec=phaseTitle(사람이 읽는 지칭)
  op: string;
  status: string;
  version: number;
  supersededBy?: number;     // MESI I(stale) — 되감기/goto 로 무효화됨
  artifacts?: string[];      // durable 산출(exec pending-write/phase-done)
  arcName?: string;          // 실시간 아크 지칭(exec 멀티아크)
  arcSeq?: string;
  note?: string;
}

/** ★ 단일 thread 통합 — build + exec 프레임을 layer 태그로 정규화해 시간순 병합. missionId 가 thread_id.
 *  tie-break: 같은 timestamp 면 build 를 exec 앞에(빌드가 실행에 선행), 그 다음 layer 내 seq. 순수. */
export function readMissionThread(missionId: string): ThreadEntry[] {
  const build: ThreadEntry[] = readFrames(missionId).map((f) => ({
    layer: 'build' as const,
    seq: f.seq, timestamp: f.timestamp, label: f.stage, op: f.op, status: f.status, version: f.version,
    ...(f.supersededBy !== undefined ? { supersededBy: f.supersededBy } : {}),
  }));
  const exec: ThreadEntry[] = readExecFrames(missionId).map((f) => ({
    layer: 'exec' as const,
    seq: f.seq, timestamp: f.timestamp, label: f.phaseTitle, op: f.op, status: f.status, version: f.version,
    ...(f.supersededBy !== undefined ? { supersededBy: f.supersededBy } : {}),
    ...(f.artifacts && f.artifacts.length ? { artifacts: f.artifacts } : {}),
    ...(f.arcName ? { arcName: f.arcName } : {}),
    ...(f.arcSeq ? { arcSeq: f.arcSeq } : {}),
    ...(f.note ? { note: f.note } : {}),
  }));
  const layerRank = (l: ThreadLayer): number => (l === 'build' ? 0 : 1);
  return [...build, ...exec].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
    if (a.layer !== b.layer) return layerRank(a.layer) - layerRank(b.layer);
    return a.seq - b.seq;
  });
}

/** 미션 thread 단면 요약(조율자 자기인지) — layer별 프레임 수·현 위치(마지막 non-superseded)·빌드→실행
 *  전이 여부·미종결 pending-write(고아) 수. "미션 전체가 지금 어디까지 왔나"를 한눈에. 순수. */
export interface MissionThreadSummary {
  missionId: string;
  buildFrames: number;
  execFrames: number;
  current: { layer: ThreadLayer; label: string; status: string } | null;  // 마지막 active 엔트리
  transitioned: boolean;      // build 프레임 있고 exec 프레임도 있으면 실행 단계로 전이함
  orphanPendingWrites: number; // 미종결 durable write(고아 후보·collectPendingWrites)
  channelVersions: ChannelVersions; // ★ 채널별 version(P0 조각3) — 어느 stage 채널이 몇 번 갱신됐나(세밀 skip/rerun)
}

export function summarizeMissionThread(missionId: string): MissionThreadSummary {
  const thread = readMissionThread(missionId);
  const build = thread.filter((e) => e.layer === 'build');
  const exec = thread.filter((e) => e.layer === 'exec');
  const active = thread.filter((e) => e.status !== 'superseded' && e.supersededBy === undefined);
  const top = active.length ? active[active.length - 1]! : null;
  let orphans = 0;
  try { orphans = collectPendingWrites(missionId).length; } catch { /* fail-soft */ }
  let channelVersions: ChannelVersions = {};
  try { channelVersions = computeChannelVersions(readFrames(missionId)); } catch { /* fail-soft */ }
  return {
    missionId,
    buildFrames: build.length,
    execFrames: exec.length,
    current: top ? { layer: top.layer, label: top.label, status: top.status } : null,
    transitioned: build.length > 0 && exec.length > 0,
    orphanPendingWrites: orphans,
    channelVersions,
  };
}
