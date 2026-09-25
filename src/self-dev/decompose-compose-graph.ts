import { inspectPipelineGraph, type PipelineGraphDefect } from '../self-implement/pipeline-shape.js';
import type { GraphNodeKind, GraphTemplate } from '../self-implement/graph-templates.js';
import { orderPiecesTopologically, type DecomposePiece } from './decompose-proposal.js';

/** ⭐ RFC §5 «5단계» — `compose` 부모 그래프.
 *
 *  RFC §4.4 는 ***"compose 그래프가 «부모»가 되고, 조각마다 자식 그래프 인스턴스를 연다"*** 라고 적었다.
 *  겹침→간선 파생은 `orderPiecesTopologically` 가 «이미» 한다(`#15782`). 여기서 더하는 것은 둘이다:
 *
 *  ⓐ 그 순서를 ***`GraphTemplate` 로 세워*** 2단계 위상 검사를 «그대로» 걸 수 있게 한다.
 *  ⓑ RFC 가 요구한 두 분모를 ***정적으로*** 잰다(원장 타임스탬프 대신 그래프 «경로»로).
 *
 *  ⛔⭐ 여기서 한 가지가 걸린다 — **부모 그래프는 진입점이 «여럿»이다**(의존 0 인 조각이 여러 개다).
 *    2단계 검사는 진입점 «하나»를 전제한다. ⇒ 합성 노드 둘(`compose:start`·`compose:done`)을 세워
 *    모양을 맞춘다. 그 둘은 조각이 아니므로 `kind: 'judge'`(라우터 자리)로 둔다. */
export const COMPOSE_START = 'compose:start' as const;
export const COMPOSE_DONE = 'compose:done' as const;

const KIND_BY_GOAL_TYPE: Readonly<Record<string, GraphNodeKind>> = {
  implement: 'agent', research: 'agent', document: 'agent', operate: 'agent',
};

export type ComposeGraphResult =
  | { ok: true; template: GraphTemplate; defects: readonly PipelineGraphDefect[] }
  | { ok: false; reason: 'cycle'; cycle: readonly string[] }
  | { ok: false; reason: 'no-pieces' };

/** 조각들을 부모 그래프로 세운다. ⛔ 순환이면 그래프를 «만들지 않는다» — 「못 세웠다」를 값으로 낸다. */
export function composeGraphFromPieces(pieces: readonly DecomposePiece[], graphId = 'compose'): ComposeGraphResult {
  if (pieces.length === 0) return { ok: false, reason: 'no-pieces' };
  const ordering = orderPiecesTopologically(pieces);
  if (!ordering.ordered) return { ok: false, reason: 'cycle', cycle: ordering.cycle ?? [] };

  const edges: Record<string, string[]> = { [COMPOSE_START]: [], [COMPOSE_DONE]: [] };
  for (const piece of pieces) edges[piece.id] = [];

  const ids = new Set(pieces.map((p) => p.id));
  const hasIncoming = new Set<string>();
  for (const piece of pieces) {
    for (const dep of piece.dependsOn) {
      if (!ids.has(dep) || dep === piece.id) continue;   // 매달린 의존은 파생기와 같은 판단으로 버린다
      if (!edges[dep]!.includes(piece.id)) { edges[dep]!.push(piece.id); hasIncoming.add(piece.id); }
    }
  }
  // hotPaths 겹침 — 파생기와 «같은 규칙»(배열 앞선 것 먼저 · 이미 길이 있으면 건너뛴다)을 쓴다.
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set([from]); const stack = [from];
    while (stack.length) { const at = stack.pop()!; if (at === to) return true;
      for (const next of edges[at] ?? []) if (!seen.has(next)) { seen.add(next); stack.push(next); } }
    return false;
  };
  pieces.forEach((piece, index) => {
    if (!piece.hotPaths?.length) return;
    for (let earlier = 0; earlier < index; earlier++) {
      const other = pieces[earlier]!;
      if (!other.hotPaths?.some((path) => piece.hotPaths!.includes(path))) continue;
      if (reaches(piece.id, other.id)) continue;
      if (!edges[other.id]!.includes(piece.id)) { edges[other.id]!.push(piece.id); hasIncoming.add(piece.id); }
    }
  });

  for (const piece of pieces) {
    if (!hasIncoming.has(piece.id)) edges[COMPOSE_START]!.push(piece.id);
    if (edges[piece.id]!.length === 0) edges[piece.id]!.push(COMPOSE_DONE);
  }

  const template: GraphTemplate = {
    graphId,
    version: '1',
    entryNode: COMPOSE_START,
    terminalNodes: [COMPOSE_DONE],
    nodes: [
      { nodeId: COMPOSE_START, kind: 'judge', maxVisits: 1 },
      ...pieces.map((p) => ({ nodeId: p.id, kind: KIND_BY_GOAL_TYPE[p.goalType ?? 'implement'] ?? 'agent', maxVisits: 1 })),
      { nodeId: COMPOSE_DONE, kind: 'judge', maxVisits: 1 },
    ],
    edges,
  };
  return { ok: true, template, defects: inspectPipelineGraph(edges, COMPOSE_START) };
}

/** RFC §5 5단계의 두 분모 — ⛔ 타임스탬프가 아니라 그래프 «경로»로 잰다.
 *  A = 겹치는 조각쌍(전부 직렬이어야 한다) · B = 겹치지 않는 쌍(하나 이상이 «나란히 갈 수» 있어야 한다).
 *  ⛔ A=0 이거나 B=0 이면 «통과가 아니라» `unmeasured` 다. */
export interface ComposeConcurrencyReport {
  readonly overlappingPairs: number;
  readonly overlappingSerialized: number;
  readonly nonOverlappingPairs: number;
  readonly nonOverlappingConcurrent: number;
  readonly verdict: 'pass' | 'fail' | 'unmeasured';
}

export function analyzeComposeConcurrency(pieces: readonly DecomposePiece[]): ComposeConcurrencyReport {
  const built = composeGraphFromPieces(pieces);
  const empty = { overlappingPairs: 0, overlappingSerialized: 0, nonOverlappingPairs: 0, nonOverlappingConcurrent: 0, verdict: 'unmeasured' as const };
  if (!built.ok) return empty;

  const reachIn = (edges: Readonly<Record<string, readonly string[]>>, from: string, to: string): boolean => {
    const seen = new Set([from]); const stack = [from];
    while (stack.length) { const at = stack.pop()!; if (at === to) return true;
      for (const next of edges[at] ?? []) if (!seen.has(next)) { seen.add(next); stack.push(next); } }
    return false;
  };

  // ⛔⭐ 「선언된 의존」과 「겹침에서 파생된 순서」를 «갈라» 본다.
  //   분해기가 dependsOn 으로 «의미로» 정한 순서는 결함이 아니다 — 그것을 「불필요한 직렬화」로 세면
  //   분모 B 가 거짓으로 0 이 되고, 통과할 판이 fail 로 뒤집힌다(이 갈림을 안 두었더니 실제로 그랬다).
  const ids = new Set(pieces.map((p) => p.id));
  const declared: Record<string, string[]> = Object.fromEntries(pieces.map((p) => [p.id, [] as string[]]));
  for (const piece of pieces) {
    for (const dep of piece.dependsOn) {
      if (ids.has(dep) && dep !== piece.id) declared[dep]!.push(piece.id);
    }
  }

  const { edges } = built.template;
  let overlappingPairs = 0, overlappingSerialized = 0, nonOverlappingPairs = 0, nonOverlappingConcurrent = 0;
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i]!, b = pieces[j]!;
      const overlaps = Boolean(a.hotPaths?.some((p) => b.hotPaths?.includes(p)));
      const serial = reachIn(edges, a.id, b.id) || reachIn(edges, b.id, a.id);
      if (overlaps) { overlappingPairs++; if (serial) overlappingSerialized++; continue; }
      // 선언된 의존으로 이미 순서가 있는 쌍은 분모 B 에서 «뺀다» — 나란히 갈 이유가 없는 쌍이다.
      if (reachIn(declared, a.id, b.id) || reachIn(declared, b.id, a.id)) continue;
      nonOverlappingPairs++;
      if (!serial) nonOverlappingConcurrent++;
    }
  }
  const verdict: ComposeConcurrencyReport['verdict'] =
    overlappingPairs === 0 || nonOverlappingPairs === 0 ? 'unmeasured'
      : overlappingSerialized === overlappingPairs && nonOverlappingConcurrent >= 1 ? 'pass'
        : 'fail';
  return { overlappingPairs, overlappingSerialized, nonOverlappingPairs, nonOverlappingConcurrent, verdict };
}
