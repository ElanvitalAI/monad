// ── logs → 미종료 작업(행 후보) ────────────────────────────────────────────
//
// ★ I-22(2026-07-31) — **행(hang)을 실패로 세는 자리.**
//
// `OBS-T3` 는 `monad self log` 가 **17분 32초** 멈춰 있던 사건이다. ⛔ 그것이 며칠을 살아남았어도
// **어느 지표에도 안 나타났을 것**이다 — 실패는 세어지지만(`abandoned`·`gate-failed`) **행은
// *"아직 도는 중"* 과 구분되지 않기 때문**이다.
//
// ⛔⭐⭐ **이 모듈은 임계값을 정하지 않는다.** *"몇 초면 행인가"* 는 명령마다 다르고, 근거 없이
// 정하면 그 숫자가 곧 자가 되어 **판정이 임의값 위에 선다**(형태 `F3`). 대신 **셀 수 있는 사실**만 낸다:
//
//     "시작 이벤트가 있는데 그 상관키로 종료 이벤트가 없다"
//
// 나이(경과 시간)는 **함께 내주되 판정하지 않는다.** 자르는 선은 **읽는 쪽이 질의 시점에** 고른다
// (`--older-than`). ⇒ 사람이 *"1시간 넘게 안 닫힌 goal-loop 셋"* 을 보고 판단한다.
//
// ⛔⭐ **짝은 추측하지 않고 실측해서 등록한다.** 어떤 이벤트가 무엇을 닫는지는 카테고리마다 다르고,
// 틀리게 등록하면 **정상 완주가 미종료로 둔갑**한다(거짓 양성이 진짜 행을 묻는다).
import { existsSync } from 'node:fs';
import type { LogQuery, LogStoreRow } from '../mss/logging/log-store.js';
import { LogStore } from '../mss/logging/log-store.js';
import { resolveLogTargets } from './logs-cli.js';

/** 한 작업의 수명 짝. ⛔ **실측으로만 등록한다**(§파일 머리말). */
export interface LifecyclePair {
  /** `category` 정확 일치. */
  category: string;
  /** 작업을 여는 이벤트. */
  start: string;
  /** 작업을 닫는 이벤트들 — ⭐ **하나라도** 오면 닫힌 것이다. */
  end: readonly string[];
  /** `data` JSON 안에서 시작·종료를 잇는 상관키 필드명. */
  correlationField: string;
  /** 사람이 읽는 이름. */
  label: string;
}

/**
 * ⭐ **실측으로 검증된 짝만 여기 있다**(2026-07-31 · `monad logs --exact-category … --since 3d`).
 *
 * ⛔ **비어 보이는 카테고리를 추측으로 채우지 마라.** `self-implement` 의 `headless.spawn` 과
 * `headless.done` 은 둘 다 `ptyId` 를 담아 그 키로 닫힘을 실측했다. `runId` 는 한 런에 여러
 * spawn 이 있어 상관키가 될 수 없다.
 */
export const LIFECYCLE_PAIRS: readonly LifecyclePair[] = [
  {
    category: 'goal.loop',
    start: 'start',
    // ⭐ `complete-rejected-tool-call` 도 종결이다 — 종결 사유가 다를 뿐 루프는 끝난다.
    //    이것을 빼면 정상 종료가 미종료로 잡힌다(거짓 양성).
    end: ['complete', 'complete-rejected-tool-call'],
    correlationField: 'sessionId',
    label: 'goal-loop',
  },
  {
    category: 'self-implement',
    start: 'headless.spawn',
    end: ['headless.done'],
    correlationField: 'ptyId',
    label: 'headless-child',
  },
];

export interface UnclosedOperation {
  label: string;
  category: string;
  correlationId: string;
  startedAtMs: number;
  startedAt: string;
  ageMs: number;
  instance: string;
  /** 시작 뒤에 **같은 카테고리·같은 상관키로** 관측된 이벤트 수.
   *  ⛔ **0 을 *"아무것도 안 했다"* 로 읽지 마라**(리뷰 1R) — 그 카테고리에 진행 이벤트가 안 찍히는
   *  작업일 수도, 다른 카테고리에 찍히는 작업일 수도 있다. 여기서 세는 것은 **이 창에서 이 키로 본
   *  이벤트 수**뿐이고, 그것이 무엇을 뜻하는지는 **사람이 그 카테고리를 알고** 판단한다. */
  activityAfterStart: number;
}

function correlationOf(row: LogStoreRow, field: string): string | null {
  if (!row.data) return null;
  try {
    const parsed = JSON.parse(row.data) as Record<string, unknown>;
    const value = parsed[field];
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;   // ⛔ 못 읽으면 없는 것으로 센다 — 있는 척하지 않는다
  }
}

/**
 * 시작은 있는데 종료가 없는 작업을 낸다. ⛔ **판정하지 않는다** — 나이를 실어 줄 뿐이다.
 *
 * ⚠️ 같은 상관키로 시작이 여러 번이면 **마지막 시작**을 본다(재시작은 앞의 것을 대체한다).
 */
export function findUnclosedOperations(
  rows: readonly LogStoreRow[],
  nowMs: number,
  pairs: readonly LifecyclePair[] = LIFECYCLE_PAIRS,
): UnclosedOperation[] {
  const out: UnclosedOperation[] = [];
  for (const pair of pairs) {
    const starts = new Map<string, LogStoreRow>();
    const closed = new Set<string>();
    const activity = new Map<string, number>();
    for (const row of rows) {
      if (row.category !== pair.category) continue;
      const id = correlationOf(row, pair.correlationField);
      if (!id) continue;
      if (row.event === pair.start) {
        starts.set(id, row);       // 재시작이면 앞의 것을 대체한다
        closed.delete(id);         // ⛔ 앞 라운드의 종료가 이번 시작을 닫은 것으로 세지 않게
        activity.set(id, 0);
      } else if (pair.end.includes(row.event)) {
        closed.add(id);
      } else if (starts.has(id)) {
        activity.set(id, (activity.get(id) ?? 0) + 1);
      }
    }
    for (const [id, row] of starts) {
      if (closed.has(id)) continue;
      out.push({
        label: pair.label,
        category: pair.category,
        correlationId: id,
        startedAtMs: row.ts_ms,
        startedAt: row.ts,
        ageMs: nowMs - row.ts_ms,
        instance: row.instance,
        activityAfterStart: activity.get(id) ?? 0,
      });
    }
  }
  // ⭐ 오래된 것부터 — 읽는 사람이 위에서부터 보면 된다.
  return out.sort((a, b) => b.ageMs - a.ageMs);
}

/** `12m` / `3h 5m` 처럼 사람이 읽는 표기. */
export function formatAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function parseDuration(raw: string): number | null {
  const rel = /^(\d+)(s|m|h|d)$/.exec(raw.trim());
  if (!rel) return null;
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[rel[2] as 's' | 'm' | 'h' | 'd'];
  return Number(rel[1]) * unit;
}

interface LifecycleScan {
  rows: LogStoreRow[];
  /** ⛔⭐⭐ 상한에 걸려 **뒤가 잘렸나**. 이 값을 무시하면 안 된다 — §아래.
   *  ⛔ `export` 하지 않는다 — 밖에 소비자가 없다(죽은 공개 표면은 계약처럼 읽힌다 · 리뷰 3R). */
  truncated: boolean;
}

/**
 * 페이지네이션으로 창 전체를 끌어온다(질의 상한 1000 을 커서로 넘는다).
 *
 * ⛔⭐⭐ **절단은 조용히 넘길 수 없다**(리뷰 1R). 페이지는 **id 오름차순**이라 잘리는 쪽은
 * **최신 구간**이고, **종료 이벤트는 시작보다 뒤에 있다** ⇒ 절단은 정확히 *"종료만 골라 버리는"*
 * 방향으로 작동한다. ⇒ **정상 완주가 미종료로 둔갑**한다. 그래서 사실을 올려 보내고 호출부가 멈춘다.
 *
 * ⛔ **검사 순서가 중요하다**(리뷰 2R·3R): 상한 검사를 소진 검사(`page.length < 1000`)보다 **먼저**
 * 해야 한다. 뒤에 두면 **마지막 부분 페이지**가 상한을 넘겨도 `truncated: false` 로 나간다.
 */
export function collectLifecycleRows(store: LogStore, sinceMs: number, maxRows = 100_000): LifecycleScan {
  const categories = [...new Set(LIFECYCLE_PAIRS.map((pair) => pair.category))];
  const all: LogStoreRow[] = [];
  let afterId = 0;
  for (;;) {
    const page = store.query({ categories, sinceMs, afterId, limit: 1000 } as LogQuery);
    if (page.length === 0) break;
    all.push(...page);
    afterId = page[page.length - 1]!.id;
    // ① 넘겨 모았으면 **확실히** 잘렸다 — 상한을 엄격히 지키고 사실을 올린다.
    if (all.length > maxRows) return { rows: all.slice(0, maxRows), truncated: true };
    // ② 정확히 같으면 **아직 모른다** — 한 행만 찔러 본다(딱 맞게 끝난 로그를 오판하지 않게).
    if (all.length === maxRows) {
      const probe = store.query({ categories, sinceMs, afterId, limit: 1 } as LogQuery);
      return { rows: all, truncated: probe.length > 0 };
    }
    // ③ 부분 페이지면 소진된 것이다.
    if (page.length < 1000) break;
  }
  return { rows: all, truncated: false };
}

/** 나이 필터 ⊕ 정렬. ⛔ 순수 — CLI 배선과 따로 테스트한다(리뷰 1R should-fix). */
export function selectForReport(found: readonly UnclosedOperation[], olderThanMs: number): UnclosedOperation[] {
  return found.filter((op) => op.ageMs >= olderThanMs).sort((a, b) => b.ageMs - a.ageMs);
}

export interface LogsUnclosedOpts {
  test?: boolean;
  instance?: string;
  since?: string;
  olderThan?: string;
  json?: boolean;
}

/** `monad logs unclosed` — 시작만 있고 종료가 없는 작업을 나이순으로 낸다. */
export function runLogsUnclosed(opts: LogsUnclosedOpts): number {
  const resolved = resolveLogTargets({ test: opts.test, instance: opts.instance });
  if (resolved.error) { console.error(`monad logs unclosed: ${resolved.error}`); return 1; }
  const sinceMs = parseDuration(opts.since ?? '24h');
  if (sinceMs === null) { console.error(`monad logs unclosed: --since 파싱 불가 '${opts.since}' (30s|15m|2h|7d)`); return 1; }
  const olderThanMs = opts.olderThan ? parseDuration(opts.olderThan) : 0;
  if (olderThanMs === null) { console.error(`monad logs unclosed: --older-than 파싱 불가 '${opts.olderThan}'`); return 1; }

  const now = Date.now();
  const found: UnclosedOperation[] = [];
  let scanned = 0;
  for (const target of resolved.targets) {
    if (!existsSync(target.dbPath)) continue;
    const store = LogStore.openReadOnly(target.dbPath);
    try {
      const scan = collectLifecycleRows(store, now - sinceMs);
      // ⛔⭐ 절단되면 **수를 내지 않고 멈춘다.** 잘린 쪽에 종료가 있으면 정상 완주가 미종료로
      //    둔갑하는데, 그 거짓 양성은 진짜 행을 묻는다. ⇒ *"틀린 수"* 보다 *"수 없음"* 이 낫다.
      if (scan.truncated) {
        console.error(`monad logs unclosed: ${target.name} 스캔이 상한에서 잘렸다 — 창을 좁혀라(--since).`);
        console.error('⛔ 잘린 쪽이 최신 구간이라 종료 이벤트가 빠질 수 있고, 그러면 정상 완주가 미종료로 잡힌다.');
        return 1;
      }
      scanned += scan.rows.length;
      found.push(...findUnclosedOperations(scan.rows, now));
    } finally { store.close(); }
  }
  const shown = selectForReport(found, olderThanMs);

  if (opts.json) {
    for (const op of shown) console.log(JSON.stringify(op));
  } else {
    for (const op of shown) {
      console.log(`  ${formatAge(op.ageMs).padStart(8)}  ${op.label.padEnd(12)} ${op.correlationId}  (같은키 이벤트 ${op.activityAfterStart} · ${op.instance})`);
    }
    // ⛔ 판정을 내지 않는다 — *"행 N건"* 이 아니라 *"미종료 N건"* 이다. 그 차이가 이 도구의 전부다.
    console.error(`\n[unclosed] 미종료 ${shown.length}건 / 스캔 ${scanned}행 · 창 ${opts.since ?? '24h'}`);
    if (shown.length > 0) {
      console.error('⚠️ "미종료" 는 "행" 이 아니다 — 아직 도는 중일 수 있다. 나이와 활동 수를 보고 사람이 판단한다.');
    }
  }
  return 0;
}
