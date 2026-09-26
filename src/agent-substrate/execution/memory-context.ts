// ── entry-independent 기억 컨텍스트 (가산 grounding) ──
//
// 어떤 진입(agent-mission·self-implement·ACP 직행)이든 elanous 기억을 빌려주는 공유 capability.
// ⭐불변식: recall 은 **프롬프트를 재작성하지 않는다** — 별도 `[memory:...]` 블록으로 **가산**(mirage 가드·
//   reasoning-corpus 규율 [[project_reasoning_corpus_unification]]와 동일: 기억은 참조 컨텍스트로만).
// 그래서 external-verbatim 진입(인핸싱 OFF)에서도 원문 프롬프트를 건드리지 않고 기억만 얹을 수 있다.
//
// 재사용: recallSelfEvents(self-awareness) + openSurfaceEventsDb. fail-soft(''=기억 없음/실패).

export interface MemoryContextOpts {
  /** recall 상한(기본 5). */
  limit?: number;
  /** 조회 기간 시간(기본 720=30일). */
  sinceHours?: number;
}

/**
 * ★ 기억 recall → 가산 컨텍스트 블록. query(보통 목표 앞부분)로 self-awareness 회상.
 *   결과 없음/실패 시 '' (호출자는 비면 안 붙임). 프롬프트 무접촉 — 별도 블록으로만.
 */
export async function recallMemoryContext(query: string, opts: MemoryContextOpts = {}): Promise<string> {
  try {
    const { recallSelfEvents } = await import('../../domains/self-awareness.js');
    const { openSurfaceEventsDb } = await import('../../domains/surface-events.js');
    const db = openSurfaceEventsDb();
    const hits = recallSelfEvents(db, query, {
      limit: opts.limit ?? 5,
      sinceHours: opts.sinceHours ?? 720,
      excludeObserverOutput: true,
    });
    if (!hits.length) return '';
    return formatMemoryContext(hits.map((hit) => ({
      text: hit.summary ?? hit.text,
      timestamp: typeof hit.ts === 'string' ? hit.ts : undefined,
      kind: typeof hit.kind === 'string' ? hit.kind : undefined,
      source: 'surface-events/self-awareness',
    })));
  } catch {
    return '';
  }
}

export interface MemoryContextItem {
  text: string;
  timestamp?: string;
  kind?: string;
  source?: string;
}

/** 회상 항목들을 출처·시간·종류가 드러나는 가산 블록으로 포맷(순수·테스트 가능). */
export function formatMemoryContext(items: Array<string | MemoryContextItem>): string {
  const facts = items.flatMap((item) => {
    if (typeof item === 'string') {
      const text = item.trim();
      return text ? [`- [memory: ${text.slice(0, 200)}]`] : [];
    }
    const text = (item.text ?? '').trim();
    if (!text) return [];
    const source = item.source?.trim() || 'memory';
    const timestamp = item.timestamp?.trim() || 'time-unavailable';
    const kind = item.kind?.trim() || 'memory';
    return [`- [memory source=${source}; time=${timestamp}; kind=${kind}] ${text.slice(0, 200)}`];
  });
  if (!facts.length) return '';
  return ['[elanous 기억 — 참조 컨텍스트(가산·프롬프트 무접촉·mirage 가드)]', ...facts].join('\n');
}
