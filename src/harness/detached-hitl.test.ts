// detached-hitl — off/safe subprocess HITL 릴레이 프로토콜/어댑터 테스트 (#24 완결)

import { describe, test, expect } from 'bun:test';
import {
  encodeHitlReq, encodeHitlRes, parseHitlReq, parseHitlRes, makeLineBuffer,
  createDetachedHitlChild, handleHitlReqLine,
  HITL_REQ_PREFIX, HITL_RES_PREFIX,
  type HitlRelay,
} from './detached-hitl.js';

describe('wire 인코딩/파싱 — 라운드트립', () => {
  test('HITLREQ 왕복', () => {
    const line = encodeHitlReq({ id: 'h1', kind: 'confirm', req: { prompt: 'PR 열까요?' } });
    expect(line.startsWith(HITL_REQ_PREFIX)).toBe(true);
    const parsed = parseHitlReq(line);
    expect(parsed).toEqual({ id: 'h1', kind: 'confirm', req: { prompt: 'PR 열까요?' } });
  });
  test('HITLRES 왕복', () => {
    const line = encodeHitlRes({ id: 'h2', kind: 'confirm', answer: true });
    expect(line.startsWith(HITL_RES_PREFIX)).toBe(true);
    expect(parseHitlRes(line)).toEqual({ id: 'h2', kind: 'confirm', answer: true });
  });
  test('접두 불일치/깨진 JSON → null', () => {
    expect(parseHitlReq('PROGRESS:foo')).toBeNull();
    expect(parseHitlRes('HITLRES:{broken')).toBeNull();
    expect(parseHitlReq('HITLREQ:{broken')).toBeNull();
  });
});

describe('makeLineBuffer — 청크 경계 안전', () => {
  test('부분 라인 재조립 + 다중 라인', () => {
    const lines: string[] = [];
    const feed = makeLineBuffer((l) => lines.push(l));
    feed('HITLREQ:{"id":"h');      // 라인 중간에서 끊김
    feed('1"}\nPROG');              // 앞 라인 완성 + 다음 라인 시작
    feed('RESS:x\n');
    expect(lines).toEqual(['HITLREQ:{"id":"h1"}', 'PROGRESS:x']);
  });
  test('개행 없는 꼬리는 보류(빈 라인 무시)', () => {
    const lines: string[] = [];
    const feed = makeLineBuffer((l) => lines.push(l));
    feed('\n\nA\n');   // 빈 라인은 스킵
    feed('tail');      // 미완성 → 보류
    expect(lines).toEqual(['A']);
  });
});

describe('자식 채널 ↔ 부모 relay — 종단 왕복', () => {
  /** 자식 emit → 부모 handleHitlReqLine → sendToChild → 자식 onStdinChunk 로 라우팅. */
  function wire(relay: HitlRelay) {
    const child = createDetachedHitlChild((line) => {
      // 부모가 라인 수신 → relay → HITLRES 를 자식 stdin 으로 회신.
      void handleHitlReqLine(line, relay, (res) => child.onStdinChunk(`${res}\n`));
    });
    return child;
  }

  test('confirm 승인(true) 왕복', async () => {
    const child = wire({ confirm: async () => true, question: async () => null });
    expect(await child.confirmChannel.request({ prompt: 'ok?' })).toBe(true);
  });

  test('confirm 거부(false) 왕복', async () => {
    const child = wire({ confirm: async () => false, question: async () => null });
    expect(await child.confirmChannel.request({ prompt: 'ok?' })).toBe(false);
  });

  test('question 결과 왕복', async () => {
    const result = { answers: { pick: 'A' }, cancelled: false };
    const child = wire({ confirm: async () => false, question: async () => result });
    const got = await child.questionChannel.ask({ questions: [] } as never);
    expect(got).toEqual(result);
  });

  test('relay throw → fail-closed(confirm=false)', async () => {
    const child = wire({ confirm: async () => { throw new Error('boom'); }, question: async () => null });
    expect(await child.confirmChannel.request({ prompt: 'ok?' })).toBe(false);
  });

  test('다중 pending — id correlation 으로 각자 resolve', async () => {
    // 지연 relay 로 두 confirm 을 동시에 띄우고, 응답 순서가 뒤바뀌어도 각자 올바른 답.
    let n = 0;
    const child = createDetachedHitlChild(async (line) => {
      const req = parseHitlReq(line)!;
      // id 홀짝으로 답을 다르게 — 순서 무관 correlation 검증. 응답을 마이크로태스크로 지연.
      const answer = req.id === 'h1';
      await Promise.resolve();
      child.onStdinChunk(`${encodeHitlRes({ id: req.id, kind: 'confirm', answer })}\n`);
    });
    const [a, b] = await Promise.all([
      child.confirmChannel.request({ prompt: '1' }),
      child.confirmChannel.request({ prompt: '2' }),
    ]);
    void n;
    expect(a).toBe(true);   // h1
    expect(b).toBe(false);  // h2
  });
});

describe('handleHitlReqLine — 비-HITLREQ 라인은 무시', () => {
  test('PROGRESS 라인 → false(미처리)', async () => {
    let sent = false;
    const handled = await handleHitlReqLine('PROGRESS:x', { confirm: async () => true, question: async () => null }, () => { sent = true; });
    expect(handled).toBe(false);
    expect(sent).toBe(false);
  });
  test('미지원 kind → fail-closed 회신(항상 응답)', async () => {
    const sentLines: string[] = [];
    const handled = await handleHitlReqLine(
      encodeHitlReq({ id: 'h9', kind: 'weird' as never, req: {} as never }),
      { confirm: async () => true, question: async () => null },
      (l) => sentLines.push(l),
    );
    expect(handled).toBe(true);
    const res = parseHitlRes(sentLines[0]!);
    expect(res?.id).toBe('h9');
    expect(res?.answer).toBeNull();   // 미지원 kind='confirm' 아님 → null fail-closed
  });
});
