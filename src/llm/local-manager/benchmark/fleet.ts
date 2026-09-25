// ── 로컬 LLM 벤치마크 · 플릿 러너 (동시성 캡 · 2026-07-15) ────────────────────────
//
// 여러 모델을 벤치하되 **동시 로드 한계**를 존중한다(대표: 동시에 띄울 모델 제한·concurrent 제한 → ~2).
// 각 target 은 자기 endpoint 를 가지므로, 노드당 1개씩(node-b+본머신) 분산하면 concurrency 2 = 머신당 1로드.
//
// ⚠️ 공정성: concurrency>1 이면 동시 실행이라 **레이턴시(워밍업/문항)가 오염**된다(경합). 점수(정답)는
// 무관하나 시간 비교는 concurrency=1(순차)이 정확. 기본은 대표 지시대로 2, 정밀 타이밍이 필요하면 1.

import type { BenchModelTarget, BenchmarkDeps, Scorecard } from './runner.js';
import { benchmarkModel } from './runner.js';

/** 동시 로드 하드캡 — 메모리 안전(대표 확정). */
export const MAX_CONCURRENCY = 2;

export interface FleetOptions extends Omit<BenchmarkDeps, 'chat' | 'tasks'> {
  /** 동시 실행 수 · 기본 2 · [1, MAX_CONCURRENCY] 로 clamp. */
  readonly concurrency?: number;
  /** target 별 벤치 시작/완료 알림(진행 표시·관측). */
  readonly onProgress?: (ev: { phase: 'start' | 'done'; target: BenchModelTarget; index: number; total: number; scorecard?: Scorecard }) => void;
  /** benchmarkModel 주입(테스트) · 기본 실제 러너. */
  readonly runOne?: (target: BenchModelTarget, deps: BenchmarkDeps) => Promise<Scorecard>;
}

/**
 * target 들을 벤치하되 **엔드포인트별 순차·엔드포인트간 병렬**로 동작한다 — 한 머신(LM Studio 인스턴스)에
 * 동시에 2모델이 올라가 JIT 스왑 thrash 하는 걸 구조적으로 막는다(같은 endpoint 는 절대 겹치지 않음).
 * 동시에 활성인 endpoint(=머신) 수는 concurrency(기본·최대 2)로 캡. 결과는 **입력 순서** 유지.
 * 한 모델이 실패해도(throw) 그 자리는 스킵하고 나머지 계속.
 */
export async function benchmarkFleet(targets: readonly BenchModelTarget[], opts: FleetOptions = {}): Promise<Scorecard[]> {
  const maxGroups = Math.max(1, Math.min(MAX_CONCURRENCY, opts.concurrency ?? MAX_CONCURRENCY));
  const runOne = opts.runOne ?? benchmarkModel;
  const perDeps: BenchmarkDeps = {
    ...(opts.exec ? { exec: opts.exec } : {}),
    ...(opts.chatTimeoutMs !== undefined ? { chatTimeoutMs: opts.chatTimeoutMs } : {}),
    ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
    ...(opts.promptPrefix !== undefined ? { promptPrefix: opts.promptPrefix } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  };

  // endpoint 별 그룹(입력 순서·원 인덱스 보존). 같은 endpoint = 한 그룹 = 순차.
  const groups = new Map<string, Array<{ target: BenchModelTarget; index: number }>>();
  targets.forEach((target, index) => {
    const g = groups.get(target.endpoint) ?? [];
    g.push({ target, index });
    groups.set(target.endpoint, g);
  });
  const groupList = [...groups.values()];
  const results: (Scorecard | undefined)[] = new Array(targets.length).fill(undefined);
  let nextGroup = 0;

  async function groupWorker(): Promise<void> {
    for (;;) {
      const gi = nextGroup++;
      if (gi >= groupList.length) return;
      for (const { target, index } of groupList[gi]!) {
        opts.onProgress?.({ phase: 'start', target, index, total: targets.length });
        try {
          const sc = await runOne(target, perDeps);
          results[index] = sc;
          opts.onProgress?.({ phase: 'done', target, index, total: targets.length, scorecard: sc });
        } catch {
          opts.onProgress?.({ phase: 'done', target, index, total: targets.length });
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(maxGroups, groupList.length) }, () => groupWorker()));
  return results.filter((r): r is Scorecard => r !== undefined);
}

/** target 식별 키(중앙값 그룹핑용). node+model 로 유일. */
export function targetKey(t: { node: string; model: string }): string {
  return `${t.node}:${t.model}`;
}

/**
 * 같은 target 의 N회 스코어카드에서 **총점 중앙값 런**을 고른다. 부분필드를 합성하지 않고 실제 런 하나를
 * 택해 내부정합(카테고리/문항/tok/s)을 보존한다. 짝수 N 은 하위 중앙(정렬 후 floor((n-1)/2))으로 결정론.
 * ⭐ 대표 실측 변동(같은 모델 60/90/100) 대응 — thinking 모델 truncation·비결정성 완화. spread=[min,max] 동봉.
 */
export function pickMedianCard(cards: readonly Scorecard[]): { median: Scorecard; spread: [number, number]; runs: number } {
  if (!cards.length) throw new Error('pickMedianCard: 빈 카드 목록');
  const sorted = [...cards].sort((a, b) => a.total - b.total);
  const mid = Math.floor((sorted.length - 1) / 2);
  return { median: sorted[mid]!, spread: [sorted[0]!.total, sorted[sorted.length - 1]!.total], runs: sorted.length };
}

/**
 * 모델 이름 목록 → target 목록(노드/엔드포인트 라운드로빈 분산). concurrency 2 + 엔드포인트 2개면 머신당
 * 1로드. endpoints 는 [{node,endpoint}] 순서로 배정.
 */
export function assignTargets(
  models: readonly string[],
  endpoints: readonly { node: string; endpoint: string }[],
): BenchModelTarget[] {
  if (!endpoints.length) throw new Error('assignTargets: endpoints 비어있음');
  return models.map((model, i) => {
    const ep = endpoints[i % endpoints.length]!;
    return { node: ep.node, model, endpoint: ep.endpoint };
  });
}
