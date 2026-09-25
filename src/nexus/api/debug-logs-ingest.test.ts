/** ⛔⭐⭐⭐ **관측 적재의 「길이 갈리지 않는다」** — 19차 `[F]` · 2026-08-22.
 *
 *  📏 배경: SSE 가 브라우저의 HTTP/1.1 커넥션 한도(6)를 먹으면
 *  `POST /v1/debug-logs/batch` 가 ***영영 큐에 서서 관측이 통째로 사라진다***(실측 8분 0건).
 *  그때 살아 있던 채널이 WebSocket 이라 ACP 확장 메서드 `monad/debug-logs/ingest` 를 열었다.
 *
 *  🔑 ⛔ **그러면 적재 경로가 «둘»이 된다** — 한쪽만 redaction 을 타거나 한쪽만 logs.db 에
 *  안 들어가면, ***폴백으로 온 관측이 조용히 다르게 취급된다.***
 *  ⇒ 그래서 REST 핸들러가 «그 공용 함수»를 쓰는지 자로 문다.
 *
 *  ## ⚠️ 이 자가 답하지 «않는» 것
 *  ACP 서버가 실제로 그 메서드를 라우팅하는지 — 그건 `src/acp/server.ts` 축이고
 *  라이브(`monad logs --event debug-logs.ingest`)로 본다. */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// ⛔⭐⭐ **시험이 사람의 상태 디렉토리를 «오염시키지» 않게 뿌리를 옮긴다** —
//   무인 리뷰 must-fix(PR #11391): *"실제 `ingestDebugLogRecords()` 를 기본 저장소로 호출하여
//   `~/.monad/debug-tap` 에 영구 테스트 레코드를 쓴다."* 🔑 옳다.
//   ⚠️ `import` «전»에 세워야 한다 — 모듈이 뿌리를 해석하는 시점이 이르다.
const TEST_ROOT = mkdtempSync(join(tmpdir(), 'monad-debug-logs-test-'));
process.env.MONAD_STATE_DIR = TEST_ROOT;

const { handleDebugLogsBatch, ingestDebugLogRecords } = await import('./debug-logs.js');

describe('debug 로그 적재 — HTTP 와 ACP 가 «같은 길»', () => {
  beforeAll(() => { process.env.MONAD_STATE_DIR = TEST_ROOT; });
  afterAll(() => {
    try { rmSync(TEST_ROOT, { recursive: true, force: true }); } catch { /* best-effort */ }
    delete process.env.MONAD_STATE_DIR;
  });

  it('⛔ 이 시험이 «사람 트리»에 안 쓴다 — 산출 경로가 임시 뿌리 안이다', () => {
    const out = ingestDebugLogRecords([
      { ts: new Date().toISOString(), category: 'probe.root', event: 'root', source: { platform: 'pwa' } },
    ]);
    expect(out.files).toHaveLength(1);
    // 🔑 이 한 줄이 「오염 안 함」을 «주장»이 아니라 «관측»으로 만든다.
    expect(out.files[0]!.startsWith(TEST_ROOT)).toBe(true);
  });

  it('⭐ 공용 함수가 유효/무효 레코드를 갈라 센다', () => {
    const out = ingestDebugLogRecords([
      { ts: new Date().toISOString(), category: 'probe.a', event: 'a', source: { platform: 'pwa' } },
      { nope: true },
      { ts: new Date().toISOString(), category: 'probe.b', event: 'b', source: { platform: 'pwa' } },
    ]);
    expect(out.accepted).toBe(2);
    expect(out.rejected).toBe(1);
  });

  it('⛔ REST 핸들러가 «그 공용 함수»를 쓴다 — 두 길이 갈리면 폴백 관측만 다르게 취급된다', () => {
    const src = readFileSync(resolve(import.meta.dir, 'debug-logs.ts'), 'utf8');
    // 주석으로 통과하지 않게 «호출 모양»을 본다.
    const body = src.slice(src.indexOf('export async function handleDebugLogsBatch'));
    expect(body).toContain('ingestDebugLogRecords(obj.records)');
  });

  it('⭐ REST 는 여전히 같은 응답 모양을 낸다 — 리팩터가 계약을 안 바꿨다', async () => {
    const req = new Request('http://x/v1/debug-logs/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ records: [
        { ts: new Date().toISOString(), category: 'probe.c', event: 'c', source: { platform: 'pwa' } },
      ] }),
    });
    const res = await handleDebugLogsBatch(req);
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; accepted: number; rejected: number; files: string[] };
    expect(json).toMatchObject({ ok: true, accepted: 1, rejected: 0 });
    expect(Array.isArray(json.files)).toBe(true);
  });

  it('⛔ ACP 확장 메서드가 «배선돼 있고» 같은 함수를 쓴다', () => {
    const acp = readFileSync(resolve(import.meta.dir, '../../acp/server.ts'), 'utf8');
    expect(acp).toContain("method === 'monad/debug-logs/ingest'");
    expect(acp).toContain('ingestDebugLogRecords(p.records)');
  });
});
