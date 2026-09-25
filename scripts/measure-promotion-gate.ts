#!/usr/bin/env bun
/**
 * ⭐ 승격 관문이 «실제 표본»에서 몇을 통과시키나 — RUN-T82 의 효과 크기 자.
 *
 * ⛔ 왜 있나: 옛 관문(`pieces.every(p => p.dependsOn.length === 0)`)의 통과율을
 *   2026-09-06 에 손으로 세어 ***0/13 = 0%*** 를 얻었다. 그 수는 «그날의 것»이고,
 *   관문을 「DAG 인가」로 바꾼 뒤의 수는 «다시 재야» 한다.
 *   ⇒ 📌 그래서 수를 문서에 박지 않고 ***이 명령을 둔다.***
 *
 * ⭐ 두 관문을 «같은 표본»에 나란히 눌러 «차이»를 낸다 — 한쪽만 재면 개선폭을 못 본다.
 *
 * ⛔⭐⭐ **소비자 함수를 «그대로» 부른다 — 옆 파서로 재지 않는다.**
 *   📏 2026-09-06 실측으로 이 규율의 값을 봤다: 같은 질문을 두 모집단에 물으니 답이 갈렸다.
 *     `monad logs`(로그 스토어 · limit 500)  ⇒ 표본  14 · 옛 관문 통과  0
 *     `readDecomposeProposals`(원장 파일)     ⇒ 표본 101 · 옛 관문 통과  2
 *   ⇒ ***승격기가 실제로 읽는 것은 뒤쪽이다.*** 앞쪽으로 재면 모집단이 7배 작고 옛 관문 통과가 0으로 보인다.
 *
 * ⚠️ **이 자가 «못 보는 것»(도구가 스스로 말한다):**
 *   ⓐ 원장에 남은 «분해 제안»을 잰다 — 그 제안이 실제 승격 «호출»까지 갔는지는 안 본다
 *      (승격은 `decision.action !== 'stop'` 일 때만 불린다 — 그 게이트는 이 자 밖이다).
 *   ⓑ 옛 원장 줄에는 `hotPaths` 가 «없다»(2026-09-06 `#15774` 이전). 그런 표본에서
 *      hotPath 간선은 «0으로 보인다» — 「간선이 안 생긴다」가 아니라 「필드가 없다」다.
 *      ⇒ 그 수를 따로 낸다(`samplesWithoutHotPaths`).
 *   ⓒ 원장 «우주»에 매인다 — `readDecomposeProposals` 가 `runLedgerDir()` 를 쓴다.
 *      ⇒ 다른 우주의 제안은 «안 보인다». 그것이 「없다」가 아니다.
 *
 * 사용:
 *   bun scripts/measure-promotion-gate.ts
 *   bun scripts/measure-promotion-gate.ts --json
 * 종료코드: 조회 실패 2 · 표본 0 이면 1(⛔ 「0%」가 아니라 「잴 대상이 없다」) · 그 밖 0.
 */
import { orderPiecesTopologically, readDecomposeProposals, type DecomposePiece } from '../src/self-dev/decompose-proposal.js';

export interface GateSample {
  ts: string;
  goalId: string;
  runId: string;
  pieces: DecomposePiece[];
}

export interface GateVerdict {
  /** 옛 관문 — 「모든 조각의 의존이 0」이어야 통과. */
  legacyPromotable: boolean;
  /** 새 관문 — 「DAG 인가」. 순환이면 거짓. */
  dagPromotable: boolean;
  dependsOnEdges: number;
  hotPathEdges: number;
  danglingDependsOn: number;
  cycle?: string[];
}

/** 순수: 한 표본을 두 관문에 «나란히» 누른다. */
export function judgeSample(pieces: readonly DecomposePiece[]): GateVerdict {
  const legacyPromotable = pieces.length > 1 && pieces.every((piece) => piece.dependsOn.length === 0);
  const ordering = orderPiecesTopologically(pieces);
  return {
    legacyPromotable,
    dagPromotable: pieces.length > 1 && ordering.ordered !== undefined,
    dependsOnEdges: ordering.dependsOnEdges,
    hotPathEdges: ordering.hotPathEdges,
    danglingDependsOn: ordering.danglingDependsOn,
    ...(ordering.cycle ? { cycle: ordering.cycle } : {}),
  };
}

/** ⛔ 소비자(`readDecomposeProposals`)를 «그대로» 부른다 — 원장 파싱을 여기서 다시 짜지 않는다. */
function readLedger(): { samples: GateSample[]; scan: ReturnType<typeof readDecomposeProposals> } {
  const scan = readDecomposeProposals({ shardIds: [] });
  const samples: GateSample[] = [];
  for (const [shardId, proposal] of scan.proposals) {
    samples.push({ ts: '', goalId: '', runId: shardId, pieces: proposal.pieces });
  }
  return { samples, scan };
}

function main(): void {
  const json = process.argv.slice(2).includes('--json');

  const { samples, scan } = readLedger();
  if (scan.directoryMissing) {
    process.stderr.write(`⛔ 원장 디렉토리가 «없다»: ${scan.ledgerDirectory} — 「0%」가 아니라 「못 읽었다」.\n`);
    process.exit(2);
  }
  if (samples.length === 0) {
    process.stderr.write('⛔ 조각 ≥2 인 분해 제안이 «0건»이다. ⛔ 「0%」가 아니라 ***「잴 대상이 없다」***.\n');
    process.exit(1);
  }

  const rows = samples.map((sample) => ({ sample, verdict: judgeSample(sample.pieces) }));
  const legacy = rows.filter((r) => r.verdict.legacyPromotable).length;
  const dag = rows.filter((r) => r.verdict.dagPromotable).length;
  const cycles = rows.filter((r) => r.verdict.cycle?.length);
  const noHotPaths = rows.filter((r) => r.sample.pieces.every((p) => !p.hotPaths?.length)).length;
  const edges = rows.reduce((acc, r) => ({
    dep: acc.dep + r.verdict.dependsOnEdges, hot: acc.hot + r.verdict.hotPathEdges,
  }), { dep: 0, hot: 0 });

  if (json) {
    process.stdout.write(JSON.stringify({
      ledgerDirectory: scan.ledgerDirectory, scannedFiles: scan.scannedFiles, unreadableFiles: scan.unreadableFiles,
      total: samples.length, legacyPromotable: legacy, dagPromotable: dag,
      cycleSamples: cycles.length, samplesWithoutHotPaths: noHotPaths, edges,
      rows: rows.map(({ sample, verdict }) => ({ runId: sample.runId, pieceCount: sample.pieces.length, ...verdict })),
    }, null, 2) + '\n');
    return;
  }

  process.stdout.write(`원장 ${scan.ledgerDirectory}\n`);
  process.stdout.write(`  스캔 파일 ${scan.scannedFiles} · ⚠️ 못 읽은 파일 ${scan.unreadableFiles}`
    + `${scan.unreadableFiles ? '  ← 「0」이 아니라 「못 읽음」이다' : ''}\n`);
  process.stdout.write(`분해 제안(조각≥2): ${samples.length}건\n`);
  process.stdout.write(`  옛 관문(의존 전부 0)  통과 ${legacy}/${samples.length}\n`);
  process.stdout.write(`  새 관문(DAG 인가)     통과 ${dag}/${samples.length}\n`);
  process.stdout.write(`  순환이라 여전히 막힘  ${cycles.length}건${cycles.length ? ` — ${cycles.map((c) => c.sample.runId.slice(0, 12)).join(', ')}` : ''}\n`);
  process.stdout.write(`  ⚠️ hotPaths 가 «아예 없는» 제안 ${noHotPaths}건 — 그 제안의 hotPath 간선 0 은 「없다」가 아니라 「못 잰다」\n`);
  process.stdout.write(`  간선 합계 — dependsOn ${edges.dep} · hotPaths ${edges.hot}\n`);
}

if (import.meta.main) main();
