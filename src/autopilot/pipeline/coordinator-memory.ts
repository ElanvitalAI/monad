// 코디네이터 워킹메모리 write 게이트 — 워킹메모리↔State 일원화 U2 + 저장 최적화 U2.5 (2026-07-19)
//
// ★ RFC-mission-memory-state-unification U2. 종전 워킹메모리 write 는 walker(run-mission.ts)가
//   appendWorkingMemory 를 직접 6곳에서 호출 — 코디네이터가 개입·정합화할 관문이 없어 중앙 State 와
//   이원화됐다(이중 진실원). 이 게이트가 **단일 write 관문**: (1) jsonl durable append(검증된 저장 머신)
//   → (2) write-time compaction 으로 성장 bound → (3) 관측. walker 는 [WORKING-MEMORY] 신호를 생산할
//   뿐, 저장은 코디네이터가 일원 관장한다.
//
// ★ U2.5 저장 최적화(대표 지시·2026-07-19) — 종전 게이트는 write 마다 assembleMissionState(TaskStore+
//   frames+ledger+wm 전부 read) 재조립 + persist 했다. 감사 결론: **persisted state.json 의 workingMemory
//   채널은 어디서도 read 되지 않는다** — `--sub state`·coordinatorStep 은 매 read 시 assembleMissionState 로
//   wm 을 fresh fold(U1)하고, phase-done 이 full snapshot 을 persist 한다. 따라서 게이트의 재조립+persist 는
//   **순수 낭비**(per-write TaskStore open·frames read·ledger evaluate). 제거 — 게이트는 append + compaction +
//   관측만. 정합성은 U1 read-time fresh fold 가 보장, 크래시 복구는 jsonl(durable)이 진실원.
//
// 시그니처는 appendWorkingMemory 와 동일 — run-mission 의 직접 호출을 순수 rename 으로 이관(우회 grep 가드).
// 전부 fail-soft(워킹메모리 write 는 미션을 절대 막지 않는다).

import { appendWorkingMemory, appendWorkingMemoryArchive, compactWorkingMemoryIfNeeded, type WorkingMemoryEntry } from '../mission-working-memory.js';
import { TaskStore } from '../../task-orchestrator/store.js';
import { debug } from '../../debug/log.js';

/** 미션 현재 리비전 세대(revise 세대) — 아카이브 파티션용. 단일 getMission(cheap·indexed) fail-soft→0.
 *  U2.5 는 write 마다의 무거운 assembleMissionState 만 제거했다 — 리비전 파티션에 필요한 이 경량 조회는 정당. */
function resolveMissionGeneration(missionId: string): number {
  try {
    const s = new TaskStore();
    try { return s.getMission(missionId)?.autopilot?.rerunGeneration ?? 0; } finally { s.close(); }
  } catch { return 0; }
}

/**
 * ★ 코디네이터 워킹메모리 기록 게이트(U2·U2.5) — 단일 write 관문. jsonl durable append + write-time compaction
 * + 관측. State 반영은 read-time fresh fold(U1)가 담당하므로 게이트는 재조립·persist 하지 않는다(U2.5 최적화).
 * 관측 mission.coordinator.memory-record{totalEntries,compacted} — "언제·무엇을 기록했고 통합 뷰가 몇 엔트리를
 * 보나". fail-soft(append/compaction 실패가 미션을 막지 않음).
 */
export function coordinatorRecordMemory(
  missionId: string,
  entry: Omit<WorkingMemoryEntry, 'at'> & { at?: string },
): void {
  try {
    appendWorkingMemory(missionId, entry);   // durable backing(검증된 jsonl 머신·라이브 워킹셋)
    // ★ U2.5 풀 아카이브(대표 지시) — 리비전(generation)별 config dir 원장에 미러(never prune). 라이브가
    //   compaction 돼도 과거 구현 스토리를 풀 보관 → 리플레이·풀 스토리. generation 은 미션에서 resolve.
    const generation = resolveMissionGeneration(missionId);
    appendWorkingMemoryArchive(missionId, entry, generation);
    // write-time compaction — 단일 writer 라 성장 bound 가능(dedup 엔트리가 tail 창 밖으로 이탈해 소실되는 것 예방).
    // 반환 = 현 유효 엔트리 수(cheap·jsonl 1회 read). State 재조립 없음(U2.5 — persisted wm 채널은 어디서도 read 안 됨).
    const { compacted, entries } = compactWorkingMemoryIfNeeded(missionId);
    // ★ 제1원칙 관측(자기인지) — "언제·무엇을 기록했고·통합 뷰가 몇 엔트리를·어느 리비전에 보관했나"를 남긴다.
    //   `monad logs --category mission.coordinator` 로 회상. totalEntries=통합 뷰 총수·gen=리비전·compacted=성장 bound.
    try {
      debug.log('mission.coordinator', 'memory-record', {
        missionId, phaseId: entry.phaseId, kind: entry.kind,
        reusables: entry.reusables?.length ?? 0, decisions: entry.decisions?.length ?? 0,
        ...(entry.deviation ? { deviation: entry.deviation.kind } : {}),
        totalEntries: entries, generation, ...(compacted ? { compacted: true } : {}),
      });
    } catch { /* fail-soft */ }
  } catch (err) {
    // ★ 실패도 관측(자기인지·셀프힐 신호) — write 관문이 조용히 삼키면 이중진실원 drift 를 못 잡는다.
    try { debug.log('mission.coordinator', 'memory-record.error', { missionId, phaseId: entry.phaseId, error: err instanceof Error ? err.message : String(err) }, { level: 'error' }); } catch { /* fail-soft */ }
  }
}
