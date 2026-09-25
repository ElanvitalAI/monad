// 연합 «전체» 변경 수집 — 「이 연합이 다 합쳐 무엇을 바꿨나」를 값으로 낸다.
//
// ⛔ 이 모듈은 ***판정하지 않는다***. 「목적을 이뤘나」를 판정할 자(연합 리뷰)의 «입력»까지다.
//
// 🔑 왜 있나 — 2026-08-19 에 사람이 손으로 연합 리뷰를 흉내 내다 틀렸다. 원인은 조각들이
//   «무엇을 바꿨는지»를 안 읽고 겉 표면만 부른 것이었고, 조각들은 그 기능을 이미 넣어 둔 뒤였다.
//   ⇒ 연합 리뷰의 입력은 «diff» 여야 한다.
//
// ⛔ 착지하지 «못한» 조각의 변경은 합집합에 넣지 않는다 — 넣으면 「연합이 바꾼 것」이 거짓이 된다.

import type { SelfDevJobResult } from './orchestrate.js';
import { hasLanded } from './orchestrate.js';

/** PR 번호로 그 PR 이 바꾼 파일 경로를 읽는 seam. 주입받아 테스트가 네트워크 없이 돈다. */
export type UnionDiffFileReader = (prNumber: number) => readonly string[] | null;

export interface OrchestrateUnionDiff {
  /**
   * `no-landed-shards` 는 「착지한 조각이 없다」이고 `collected` 의 files 0 과 «다르다».
   * `unavailable` 은 「조회가 실패했다」이고 「아무것도 안 바꿨다」와 «다르다».
   */
  readonly status: 'no-landed-shards' | 'collected' | 'unavailable';
  /** 합집합에 들어간(=착지한) 조각 수. */
  readonly landedShardCount: number;
  /** 파일 목록을 «실제로 읽어낸» 조각 수. */
  readonly readShardCount: number;
  /** 착지했으나 파일 목록을 못 읽은 조각 수. ⛔ 0 이 아니면 files 는 «부분»이다. */
  readonly unreadableShardCount: number;
  /** 착지한 조각들이 건드린 파일의 «합집합»(정렬·중복 제거). */
  readonly files: readonly string[];
}

/**
 * 착지한 조각들의 PR 에서 변경 파일을 모아 합집합을 낸다.
 * ⛔ 조회 실패는 «못 읽음»으로 세고 절대 「바꾼 것 없음」으로 접지 않는다.
 */
export function collectOrchestrateUnionDiff(
  results: readonly SelfDevJobResult[],
  readFiles: UnionDiffFileReader,
): OrchestrateUnionDiff {
  const landed = results.filter((result) => hasLanded(result));
  if (landed.length === 0) {
    return { status: 'no-landed-shards', landedShardCount: 0, readShardCount: 0, unreadableShardCount: 0, files: [] };
  }
  const union = new Set<string>();
  let read = 0;
  let unreadable = 0;
  for (const shard of landed) {
    const files = shard.prNumber === undefined ? null : safeRead(readFiles, shard.prNumber);
    if (files === null) { unreadable++; continue; }
    read++;
    for (const path of files) if (path) union.add(path);
  }
  return {
    status: read === 0 ? 'unavailable' : 'collected',
    landedShardCount: landed.length,
    readShardCount: read,
    unreadableShardCount: unreadable,
    files: [...union].sort(),
  };
}

/** 읽기 실패를 «못 읽음»으로 되돌린다 — 던지면 합집합이 조용히 부분이 되기 때문. */
function safeRead(readFiles: UnionDiffFileReader, prNumber: number): readonly string[] | null {
  try {
    return readFiles(prNumber);
  } catch {
    return null;
  }
}
