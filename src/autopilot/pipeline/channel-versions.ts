// 채널별 버전 — 프레임별 version → 채널별 version (조율자 격상 P0·조각 3/3)
//
// ★ RFC P0(체크포인터 승격)의 "channel_versions(프레임별→채널별 version·세밀 skip/rerun)". LangGraph
//   Checkpoint.channel_versions 이식: 프레임 저널은 프레임당 단일 version 만 갖지만, 어느 "채널"
//   (=빌드 stage 결과 + decisions)이 몇 번 갱신됐는지는 안 담긴다. 이 모듈이 프레임 시퀀스에서
//   채널별 version 을 순수 파생해, "무엇이 바뀌었나"를 채널 단위로 안다 → 세밀 skip/rerun(바뀐 채널의
//   하류만 재실행)과 P1 typed 채널/reducer 의 토대. 프레임 스키마 무변경(기존 저널 그대로 동작).
// 전부 순수·결정론(입력 프레임 → 채널 version 맵). I/O 없음.

import type { PipelineFrame } from './frame-types.js';

/** decisions 채널의 논리 이름(빌드 stage 채널과 한 네임스페이스). */
export const DECISIONS_CHANNEL = 'decisions';

/** 채널 version 맵 — 채널명(stage | 'decisions') → 갱신 횟수(1부터·미기록=부재). */
export type ChannelVersions = Record<string, number>;

/** 프레임 시퀀스 → 채널별 version. 각 프레임의 output(=그 stage 채널 write) 이 채널 version 을 +1.
 *  decisions 는 직전 프레임 대비 JSON 이 바뀌면 +1(reducer 없는 현 blackboard 의 근사). superseded
 *  프레임(MESI I·되감기로 무효화)은 세지 않는다(현재 유효 상태만 반영). seq 순 처리. 순수. */
export function computeChannelVersions(frames: readonly PipelineFrame[]): ChannelVersions {
  const versions: ChannelVersions = {};
  let lastDecisions: string | null = null;
  for (const f of [...frames].sort((a, b) => a.seq - b.seq)) {
    if (f.status === 'superseded' || f.supersededBy !== undefined) continue;
    // stage 결과 채널 — output 이 있으면 그 stage 채널이 갱신됨.
    if (f.output) {
      const ch = f.output.stage;
      versions[ch] = (versions[ch] ?? 0) + 1;
    }
    // decisions 채널 — 스냅샷의 decisions 가 직전과 달라졌으면 갱신(근사·reducer 는 P1).
    const dec = JSON.stringify(f.inputsSnapshot?.decisions ?? {});
    if (lastDecisions !== null && dec !== lastDecisions) {
      versions[DECISIONS_CHANNEL] = (versions[DECISIONS_CHANNEL] ?? 0) + 1;
    }
    lastDecisions = dec;
  }
  return versions;
}

/** 특정 seq 시점(포함)까지의 채널 version — 리플레이/rerun 이 "이 지점 이후 무엇이 바뀌나"의 기준선. 순수. */
export function channelVersionsAt(frames: readonly PipelineFrame[], seq: number): ChannelVersions {
  return computeChannelVersions(frames.filter((f) => f.seq <= seq));
}

/** 두 채널 version 맵 사이에 version 이 오른(또는 새로 생긴) 채널 집합 = "무엇이 바뀌었나". 세밀 skip/rerun
 *  의 결정 신호(바뀐 채널의 하류 stage 만 재실행). from 없거나 낮으면 changed. 순수·결정론. */
export function changedChannels(from: ChannelVersions, to: ChannelVersions): string[] {
  const out: string[] = [];
  for (const ch of Object.keys(to)) {
    if ((to[ch] ?? 0) > (from[ch] ?? 0)) out.push(ch);
  }
  return out.sort();
}

/** 편의 — fromSeq 이후 toSeq 까지 바뀐 채널(둘 다 프레임 시퀀스에서 파생). 순수. */
export function channelsChangedBetween(frames: readonly PipelineFrame[], fromSeq: number, toSeq: number): string[] {
  return changedChannels(channelVersionsAt(frames, fromSeq), channelVersionsAt(frames, toSeq));
}
