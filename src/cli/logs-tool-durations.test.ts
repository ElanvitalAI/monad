import { describe, expect, test } from 'bun:test';
import type { LogStoreRow } from '../mss/logging/log-store.js';
import { collectDurationRows, renderToolDurations, runLogsToolDurations, summarizeToolDurations, type LogsToolDurationsDeps } from './logs-tool-durations.js';
import { STORE_SAFETY_MAX } from '../mss/logging/log-store.js';

let id = 0;
function row(category: string, event: string, data: unknown, sessionId: string | null = 'session', instance = 'test', tsMs?: number): LogStoreRow {
  id += 1;
  const timestamp = tsMs ?? id;
  return { id, ts: new Date(timestamp).toISOString(), ts_ms: timestamp, level: 'info', instance, surface: 'test', category, event, session_id: sessionId, trace_id: null, data: JSON.stringify(data) };
}
function chatCall(tool: string, callId: string, instance?: string, tsMs?: number): LogStoreRow { return row('chat.tool-call', tool, { id: callId }, 'session', instance, tsMs); }
function chatDone(tool: string, callId: string, elapsedMs: unknown, instance?: string, tsMs?: number): LogStoreRow { return row('chat.tool-result', tool, { id: callId, elapsedMs }, 'session', instance, tsMs); }
function coreStart(tool: string, dispatchCount: number, tsMs?: number): LogStoreRow { return row('core.turn', 'dispatch', { sessionId: 'core', tool, dispatchCount }, 'core', 'test', tsMs); }
function coreDone(tool: string, dispatchCount: number, durationMs: unknown, tsMs?: number): LogStoreRow { return row('core.turn', 'dispatch-done', { sessionId: 'core', tool, dispatchCount, durationMs }, 'core', 'test', tsMs); }
function deps(targetRows: Record<string, LogStoreRow[]>, output: string[], selected: unknown[] = [], requested: number[] = []): LogsToolDurationsDeps {
  return {
    exists: () => true,
    openReadOnly: (path) => ({
      close() {},
      query: ({ beforeId, limit = 0, exactCategories }: { beforeId?: number; limit?: number; exactCategories?: string[] }) => {
        requested.push(limit);
        return (targetRows[path] ?? []).filter((r) => (beforeId === undefined || r.id < beforeId)
          && (!exactCategories || exactCategories.includes(r.category)))
          .sort((a, b) => b.id - a.id).slice(0, limit);
      },
    }) as never,
    resolveTargets: (options) => { selected.push(options); return { targets: Object.keys(targetRows).map((dbPath) => ({ name: dbPath, dbPath })) }; },
    write: (line) => output.push(line),
    writeError: (line) => output.push(`ERROR ${line}`),
  };
}

describe('logs tool durations', () => {
  test('경로별로 동일 툴명을 합치지 않고 중앙값·p90·최댓값을 낸다', () => {
    const rows = [...Array.from({ length: 10 }, (_, i) => [chatCall('Bash', `chat-${i}`), chatDone('Bash', `chat-${i}`, i + 1)]).flat(), coreStart('Bash', 1), coreDone('Bash', 1, 100)];
    expect(summarizeToolDurations(rows).paths).toEqual([
      { path: 'chat-surface', sampleStatus: 'ok', unmatched: 0, tools: [{ tool: 'Bash', count: 10, medianMs: 5.5, p90Ms: 9, maxMs: 10 }] },
      { path: 'headless-core', sampleStatus: 'ok', unmatched: 0, tools: [{ tool: 'Bash', count: 1, medianMs: 100, p90Ms: 100, maxMs: 100 }] },
    ]);
  });

  test('손상·고아·툴명 불일치 양쪽을 미연결으로 세고 표본 없음을 숫자 0과 구별한다', () => {
    const report = summarizeToolDurations([
      chatCall('Read', 'paired'), chatDone('Read', 'paired', 5), chatCall('Bash', 'orphan-start'), chatDone('Write', 'orphan-end', 7),
      chatCall('Edit', 'mismatch'), chatDone('Write', 'mismatch', 2), chatCall('Edit', 'bad-duration'), chatDone('Edit', 'bad-duration', 'bad'),
      coreStart('Read', 1), coreDone('Read', 1, 3), coreStart('Bash', 2), coreDone('Write', 3, 4),
    ]);
    expect(report.paths[0]).toMatchObject({ path: 'chat-surface', sampleStatus: 'ok', unmatched: 6, tools: [{ tool: 'Read', count: 1 }] });
    expect(report.paths[1]).toMatchObject({ path: 'headless-core', sampleStatus: 'ok', unmatched: 2, tools: [{ tool: 'Read', count: 1 }] });
    const onlyCore = summarizeToolDurations([coreStart('Bash', 4), coreDone('Bash', 4, 9)]);
    expect(onlyCore.paths[0]).toMatchObject({ path: 'chat-surface', sampleStatus: 'no-samples', unmatched: 0 });
    expect(renderToolDurations(onlyCore)).toContain('표본 없음');
  });

  test('통합 관련 행은 최신 시간순으로 제한하고 실제 추가 행이 있을 때만 절단으로 표시한다', () => {
    const exact = [chatCall('Bash', 'a', undefined, 10), coreStart('Read', 1, 20)];
    const more = [...exact, coreDone('Read', 1, 7, 30)];
    const requested: number[] = [];
    const store = deps({ exact }, [], [], requested).openReadOnly('exact') as never;
    expect(collectDurationRows(store, { exactCategories: ['chat.tool-call', 'chat.tool-result', 'core.turn'] }, 2, 2)).toMatchObject({ rows: [exact[1], exact[0]], readRows: 2, truncated: false });
    const newerStore = deps({ more }, []).openReadOnly('more') as never;
    expect(collectDurationRows(newerStore, { exactCategories: ['chat.tool-call', 'chat.tool-result', 'core.turn'] }, 2, 2)).toMatchObject({ rows: [more[2], more[1]], truncated: true });
    expect(requested).toEqual([2, 2]);
  });

  test('인스턴스별 통합 최신 범위가 경로 순서보다 우선하고 범위 옵션과 사람·JSON 출력을 보존한다', () => {
    const targetA = [chatCall('Read', 'old', 'same-instance', 10), chatDone('Read', 'old', 2, 'same-instance', 20), coreStart('Bash', 1, 30), coreDone('Bash', 1, 9, 40)];
    const targetB = [chatCall('Read', 'exact', 'same-instance', 10), chatDone('Read', 'exact', 2, 'same-instance', 20)];
    const output: string[] = [];
    const selected: unknown[] = [];
    const d = deps({ targetA, targetB }, output, selected);
    expect(runLogsToolDurations({ all: true, includeTest: true, limit: '2', json: true }, d)).toBe(0);
    expect(selected).toEqual([{ test: undefined, instance: undefined, all: true, includeTest: true }]);
    const report = JSON.parse(output[0]!);
    // ⭐ 리뷰 must-fix 2라운드(2026-08-19): 종전엔 rows:6 이었다 — 첫 페이지가 STORE_SAFETY_MAX 라
    //   `--limit 2` 를 줘도 스토어를 넓게 읽었기 때문이다. 이제 첫 조회가 maxRows+1 에서 시작하므로
    //   ***읽는 양 자체가 준다***(6 → 5). 이 수가 「조회가 잘렸다」의 증거다.
    expect(report).toMatchObject({ instances: 2, rows: 5, truncated: true, paths: [
      { path: 'chat-surface', sampleStatus: 'ok', tools: [{ tool: 'Read', count: 1, maxMs: 2 }], unmatched: 0 },
      { path: 'headless-core', sampleStatus: 'ok', tools: [{ tool: 'Bash', count: 1, maxMs: 9 }], unmatched: 0 },
    ] });
    output.length = 0;
    expect(runLogsToolDurations({ limit: '2' }, d)).toBe(0);
    expect(output[0]).toContain('limit reached');

    const exactOutput: string[] = [];
    expect(runLogsToolDurations({ limit: '2', json: true }, deps({ targetB }, exactOutput))).toBe(0);
    expect(JSON.parse(exactOutput[0]!)).toMatchObject({ truncated: false, paths: [{ path: 'chat-surface', sampleStatus: 'ok' }, { path: 'headless-core', sampleStatus: 'no-samples' }] });
  });

  // ⛔⭐⭐ 리뷰가 GOODHART 로 지목한 자리를 «기본 경로»로 막는다 —
  //   종전 제한 테스트는 collectDurationRows 에 pageSize=2 를 «주입»해 통과했고,
  //   그래서 runLogsToolDurations 의 «기본» 페이지 크기(STORE_SAFETY_MAX)를 한 번도 안 탔다.
  //   ⇒ 여기서는 ***주입 없이*** 명령 경로로 들어가 첫 조회의 상한을 직접 본다.
  test('⛔ --limit 은 «산출»이 아니라 «조회»를 자른다 — 기본 경로에서 첫 조회 상한이 maxRows+1 이다', () => {
    const many = Array.from({ length: 50 }, (_, i) => [chatCall('Read', `k${i}`, 'inst', i * 10), chatDone('Read', `k${i}`, 2, 'inst', i * 10 + 5)]).flat();
    const requested: number[] = [];
    const output: string[] = [];
    const d = deps({ only: many }, output, [], requested);
    expect(runLogsToolDurations({ limit: '3', json: true }, d)).toBe(0);
    // 첫 조회가 «3+1» 을 넘지 않는다 — 종전엔 여기가 STORE_SAFETY_MAX 였다.
    expect(requested[0]).toBeLessThanOrEqual(4);
    // 그리고 어떤 조회도 스토어 안전 상한을 넘지 않는다.
    for (const limit of requested) expect(limit).toBeLessThanOrEqual(STORE_SAFETY_MAX);
  });
});
