// C5d (2026-07-16) — ACP 청크 producer. ACP 턴 델타를 통합 fan-out 으로 tee(tg/dc/pwa 미러),
// ACP 자기 peer('acp' 구독자)는 excludeKeys 로 제외(옛 direct broadcast 가 서빙 → 이중 방지).

import { describe, test, expect, afterEach, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StreamingSurfaceSink } from '../src/session/session-fanout.js';

const ORIG = process.env.ELANOUS_SESSION_ROOT;
let tmp: string;
beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'sess-c5d-'));
  process.env.ELANOUS_SESSION_ROOT = tmp;
  const { _clearSubscriberIndexForTest } = await import('../src/session/index.js');
  const { _clearStreamingSinksForTest } = await import('../src/session/session-fanout.js');
  _clearSubscriberIndexForTest();
  _clearStreamingSinksForTest();
});
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  if (ORIG === undefined) delete process.env.ELANOUS_SESSION_ROOT; else process.env.ELANOUS_SESSION_ROOT = ORIG;
});

function recSink(log: Array<[string, string]>, surface: string): StreamingSurfaceSink {
  return {
    onChunk: (endpoint, ev) => log.push([`${surface}:chunk`, ev.delta ?? ev.tool?.name ?? ev.reasoning ?? '']),
    onFinal: (endpoint, ev) => { log.push([`${surface}:final`, ev.text]); },
  };
}

describe('makeAcpChunkProducer', () => {
  test('ACP 턴 델타 → tg 미러·acp self 제외(이중 방지)', async () => {
    const S = await import('../src/session/index.js');
    const { registerStreamingSink } = await import('../src/session/session-fanout.js');
    const { makeAcpChunkProducer } = await import('../src/session/streaming/chunk-producer.js');
    const { acpEndpointKey } = await import('../src/session/session-endpoint-key.js');

    const m = S.createSession({ source: 'cli' }, tmp);
    const acpEp = acpEndpointKey({ sessionId: m.id });
    S.subscribeSession(m.id, { surface: 'acp', endpoint: acpEp }, {}, tmp);       // ACP 자기 peer
    S.subscribeSession(m.id, { surface: 'telegram', endpoint: 't' }, {}, tmp);    // 미러 대상

    const log: Array<[string, string]> = [];
    registerStreamingSink('acp', recSink(log, 'acp'));
    registerStreamingSink('telegram', recSink(log, 'tg'));

    const selfKey = S.subscriberKey('acp', acpEp);
    const producer = makeAcpChunkProducer(m.id, { root: tmp, excludeKeys: [selfKey] });
    producer.delta('hi');
    producer.tool('t1', 'Bash', 'call');
    producer.reasoning('생각');

    // acp self 는 제외 → tg 만 수신.
    expect(log.some(([k]) => k === 'acp:chunk')).toBe(false);
    expect(log).toContainEqual(['tg:chunk', 'hi']);
    expect(log).toContainEqual(['tg:chunk', 'Bash']);
    expect(log).toContainEqual(['tg:chunk', '생각']);
  });

  test('excludeKeys 없으면 acp self 도 수신(flip reverse: tg 턴→acp 는 이 경로 아님·대칭 확인)', async () => {
    const S = await import('../src/session/index.js');
    const { registerStreamingSink } = await import('../src/session/session-fanout.js');
    const { makeAcpChunkProducer } = await import('../src/session/streaming/chunk-producer.js');
    const { acpEndpointKey } = await import('../src/session/session-endpoint-key.js');

    const m = S.createSession({ source: 'cli' }, tmp);
    S.subscribeSession(m.id, { surface: 'acp', endpoint: acpEndpointKey({ sessionId: m.id }) }, {}, tmp);
    const log: Array<[string, string]> = [];
    registerStreamingSink('acp', recSink(log, 'acp'));

    const producer = makeAcpChunkProducer(m.id, { root: tmp }); // excludeKeys 없음
    producer.delta('z');
    expect(log).toContainEqual(['acp:chunk', 'z']);
  });
});
