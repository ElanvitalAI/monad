// 파이프라인 프레임 — append-only 히스토리 · replay · rewind (공용·중립 · 2026-07-20 C5 승격).
//
// 원본: src/autopilot/pipeline/frame-{types,replay,rewind}.ts(제1원칙 물리 토대·P0~P3). 각 단계 1회 실행 =
// 한 "프레임"(함수콜 프레임 은유). append-only 저널이:
//   - 관측성: 무슨 인자(inputsSnapshot)로 무엇을 냈나(output)를 사후에 본다.
//   - 자기인지: 스택 재구성 → "지금 어느 단계·뭐가 stale·stuck"인지 스스로.
//   - 셀프힐링: 저장 인자로 그 지점 되감아(rewind/goto) 수복.
//
// ★ 이 모듈은 **도메인-무관 제네릭 코어**(DESIGN §16 C5): 프레임 모델·replay/rewind 알고리즘. state fold·
//   emptyState·frameId 발급은 **주입**(dependency injection)이라 도메인(미션 Blackboard·하니스 State)이
//   각자 넘긴다. 미션 바인딩(foldResult/emptyBlackboard/supersede/makeFrameId)은 autopilot 잔류. 전부 순수.

/** 단계 상태 ENUM. superseded = goto/rerun 으로 무효화된 프레임(MESI I). */
export type StageStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'superseded';

/** 프레임을 만든 조작 — 리플레이 재현 + 셀프힐 감사. */
export type FrameOp = 'push' | 'pop' | 'goto' | 'skip';

/** LLM 단계 메타(원문은 sidecar 분리·프레임엔 chars 만). */
export interface FrameLlmMeta { model: string; promptChars: number; responseChars: number }

/** 파이프라인 프레임 = 한 단계 실행의 완전 기록(리플레이·되감기의 단위). 제네릭:
 *  TStage=단계 enum · TState=진입 스냅샷(blackboard) · TOutput=산출. */
export interface PipelineFrame<TStage, TState, TOutput> {
  frameId: string;              // `${safeMissionId}:${seq}` — 저널 내 결정론 식별자
  missionId: string;
  seq: number;                  // 단조증가 — 순서·최신 판정
  stageIndex: number;           // 단계 순서(ENUM)
  stage: TStage;
  status: StageStatus;
  timestamp: string;            // ISO8601
  op: FrameOp;
  inputsSnapshot: TState;       // ★ 이 단계의 "인자" — 진입 시점 상태(순수·불변이라 완전 복원)
  output?: TOutput;             // 산출(fan-in 될 결과)
  version: number;              // goto/rerun 시 옛 프레임 supersede 판정
  supersededBy?: number;        // 무효화한 프레임 seq(MESI S→I)
  generation?: number;          // rerun 세대(파티션)
  via?: 'coordinator' | 'sequential'; // 이 프레임을 쓴 실행 컨트롤러(owner 관측)
  llm?: FrameLlmMeta;
}

// ── Replay(P2·저장 출력 재생·결정론) ────────────────────────────────────────

export interface ReplayResult<TStage, TState> {
  blackboard: TState;
  replayed: TStage[];       // 재생된(output fold) 단계
  skipped: TStage[];        // superseded/failed/output 없음 skip
  stoppedAt?: TStage;       // toStage 지정 시 멈춘 지점
}

/** 저장된 프레임 output 재생(fold·LLM 0·결정론). superseded/failed/되감기마커 skip. fold·emptyState 는
 *  주입(도메인 상태 병합 로직). toStage 지정 시 그 단계까지만. 순수. */
export function replayFrames<TStage, TState, TOutput>(
  frames: readonly PipelineFrame<TStage, TState, TOutput>[],
  deps: {
    emptyState: () => TState;
    fold: (state: TState, frame: PipelineFrame<TStage, TState, TOutput>) => TState;
  },
  opts: { toStage?: TStage } = {},
): ReplayResult<TStage, TState> {
  const bySeq = [...frames].sort((a, b) => a.seq - b.seq);
  let bb = deps.emptyState();
  const replayed: TStage[] = [];
  const skipped: TStage[] = [];
  let stoppedAt: TStage | undefined;
  for (const f of bySeq) {
    // 되감기 마커(pop/goto)는 실행 프레임이 아니라 조작 기록 — 재생 대상 아님.
    if (f.op === 'pop' || f.op === 'goto') continue;
    if (f.status === 'superseded' || f.status === 'failed' || f.output === undefined) {
      skipped.push(f.stage);
    } else {
      bb = deps.fold(bb, f);
      replayed.push(f.stage);
    }
    if (opts.toStage !== undefined && f.stage === opts.toStage) { stoppedAt = f.stage; break; }
  }
  return { blackboard: bb, replayed, skipped, ...(stoppedAt !== undefined ? { stoppedAt } : {}) };
}

// ── Rewind(P3·rewind/goto·셀프힐) ───────────────────────────────────────────

export interface RewindPlan<TStage, TState, TOutput> {
  ok: boolean;
  reason?: string;
  restoredBlackboard?: TState;      // 되감긴 지점의 인자(target.inputsSnapshot)
  targetStage?: TStage;
  targetSeq?: number;
  framesToAppend: PipelineFrame<TStage, TState, TOutput>[];  // supersede 마킹 + 되감기 기록(역사 보존)
}

/** frameId 발급 seam — `${safeMissionId}:${seq}` 등 도메인 규칙 주입. */
export type MakeFrameId = (missionId: string, seq: number) => string;

/** 활성 push 프레임(non-superseded)만 seq 순. */
function activePush<TStage, TState, TOutput>(
  frames: readonly PipelineFrame<TStage, TState, TOutput>[],
): PipelineFrame<TStage, TState, TOutput>[] {
  return frames.filter((f) => f.op === 'push' && f.status !== 'superseded').sort((a, b) => a.seq - b.seq);
}

/** N 단계 전으로 되감기 — 활성 top 에서 n 개 이전 프레임. */
export function rewind<TStage, TState, TOutput>(
  frames: readonly PipelineFrame<TStage, TState, TOutput>[],
  n: number,
  nowIso: string,
  makeFrameId: MakeFrameId,
): RewindPlan<TStage, TState, TOutput> {
  const active = activePush(frames);
  if (!active.length) return { ok: false, reason: '되감을 활성 프레임 없음', framesToAppend: [] };
  const idx = Math.max(0, active.length - 1 - Math.max(0, n));
  return buildPlan(frames, active[idx]!, 'pop', nowIso, makeFrameId);
}

/** 특정 단계로 되감기 — 그 stage 최신 done 프레임. */
export function gotoStage<TStage, TState, TOutput>(
  frames: readonly PipelineFrame<TStage, TState, TOutput>[],
  stage: TStage,
  nowIso: string,
  makeFrameId: MakeFrameId,
): RewindPlan<TStage, TState, TOutput> {
  const cand = activePush(frames).filter((f) => f.stage === stage && f.status === 'done');
  if (!cand.length) return { ok: false, reason: `${String(stage)} done 프레임 없음(되감기 불가)`, framesToAppend: [] };
  return buildPlan(frames, cand[cand.length - 1]!, 'goto', nowIso, makeFrameId);
}

/** 되감기 계획 — 타겟 이후 활성 프레임 supersede + 되감기 기록 프레임. 순수. version 승격은 인라인
 *  (newVer=maxVer+1·supersededBy=newVer — supersedeDecision(MESI) 의 이 용법 결과와 동형). */
function buildPlan<TStage, TState, TOutput>(
  frames: readonly PipelineFrame<TStage, TState, TOutput>[],
  target: PipelineFrame<TStage, TState, TOutput>,
  op: FrameOp,
  nowIso: string,
  makeFrameId: MakeFrameId,
): RewindPlan<TStage, TState, TOutput> {
  const maxSeq = Math.max(...frames.map((f) => f.seq));
  const maxVer = Math.max(0, ...frames.map((f) => f.version));
  const newVer = maxVer + 1;
  let seq = maxSeq + 1;
  const appends: PipelineFrame<TStage, TState, TOutput>[] = [];
  // 타겟 이후(seq >) 활성 push 프레임 → superseded 마킹 프레임 재-append(마지막 seq 이김).
  for (const f of frames.filter((x) => x.op === 'push' && x.status !== 'superseded' && x.seq > target.seq).sort((a, b) => a.seq - b.seq)) {
    appends.push({
      ...f, frameId: makeFrameId(f.missionId, seq), seq: seq++,
      status: 'superseded', supersededBy: newVer,
      op, timestamp: nowIso, version: newVer,
    });
  }
  // 되감기 기록(역사 보존) — 타겟 위치로 이동했음을 남긴다.
  appends.push({
    frameId: makeFrameId(target.missionId, seq), missionId: target.missionId, seq: seq++,
    stageIndex: target.stageIndex, stage: target.stage, status: 'done', timestamp: nowIso,
    op, inputsSnapshot: target.inputsSnapshot, ...(target.output !== undefined ? { output: target.output } : {}), version: newVer,
  });
  return { ok: true, restoredBlackboard: target.inputsSnapshot, targetStage: target.stage, targetSeq: target.seq, framesToAppend: appends };
}
