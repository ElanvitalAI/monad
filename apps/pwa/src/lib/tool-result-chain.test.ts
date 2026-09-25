// ── 데몬 → PWA «전 구간» 회귀 ──
//
// ⛔⭐⭐ **이 시험이 있는 이유**: 2026-08-20 에 보내는 쪽(`#10698`)과 읽는 쪽(`#10696`)이
//    «서로 다른 이름»으로 착지해 위젯 주소가 영영 안 왔다(`result` ↔ `rawOutput`).
//    ⚠️ 리뷰는 그것을 «원리상» 못 잡는다 — 두 골이 «다른 PR» 이라 각자 한쪽 diff 만 본다.
//    ⇒ 그래서 «양쪽을 한 시험에서» 잇는다. 한쪽 이름이 바뀌면 여기서 깨진다.

import { describe, test, expect } from 'bun:test';
import { projectPwaToolResult } from '../../../../src/nexus/api/meta-api';
import { parsePromptSseStream } from './daemon-client';

/** 데몬이 실제로 내보내는 형태 그대로 SSE 를 만들어 PWA 파서에 먹인다. */
async function throughChain(info: Parameters<typeof projectPwaToolResult>[0]) {
  const payload = projectPwaToolResult(info);
  const sse =
    `event: tool-result\ndata: ${JSON.stringify(payload)}\n\n` +
    `event: turn-end\ndata: {"sessionId":"s","text":"","stopReason":"end_turn"}\n\n`;
  const seen: Array<Record<string, unknown>> = [];
  const stream = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); },
  });
  await parsePromptSseStream(stream, {
    onToolResult: (i: unknown) => seen.push(i as Record<string, unknown>),
  } as never);
  return seen[0];
}

describe('툴 결과 — 데몬에서 PWA 까지 «한 시험으로»', () => {
  test('⭐ 위젯 주소가 끝까지 온다 (규범 형태)', async () => {
    const got = await throughChain({
      id: 'c1', name: 'generate_image', ok: true, summary: 'submitted',
      result: { output: 'ok', _meta: { ui: { resourceUri: 'ui://vendor/gen.html' } } },
    });
    expect(got?.resourceUri).toBe('ui://vendor/gen.html');
    expect(got?.rawOutput).toEqual({ output: 'ok', _meta: { ui: { resourceUri: 'ui://vendor/gen.html' } } });
  });

  test('⭐ 납작한 형태도 끝까지 온다 — 상대가 «둘 다» 보낸다', async () => {
    const got = await throughChain({
      id: 'c2', name: 'x', ok: true,
      result: { 'ui/resourceUri': 'ui://vendor/flat.html' },
    });
    expect(got?.resourceUri).toBe('ui://vendor/flat.html');
  });

  test('⛔ 화면이 «없는» 툴이면 주소 칸도 없다', async () => {
    const got = await throughChain({ id: 'c3', name: 'balance', ok: true, result: { credits: 1 } });
    expect(got).not.toHaveProperty('resourceUri');
    expect(got?.rawOutput).toEqual({ credits: 1 });
  });

  test('⛔ 결과가 «너무 크면» 값이 빠지고 그 «아는 사실»만 온다', async () => {
    const got = await throughChain({
      id: 'c4', name: 'big', ok: true,
      result: { blob: 'x'.repeat(70 * 1024) },
    });
    expect(got).not.toHaveProperty('rawOutput');
    expect(got?.resultOmittedReason).toBe('too_large');
  });

  test('⛔ 기존 네 칸은 그대로 온다 — 이 착지가 그것을 안 깬다', async () => {
    const got = await throughChain({ id: 'c5', name: 'x', ok: false, summary: '42 things' });
    expect(got?.id).toBe('c5');
    expect(got?.ok).toBe(false);
    expect(got?.summary).toBe('42 things');
  });
});
