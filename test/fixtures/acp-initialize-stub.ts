// 최소 ACP 에이전트 스텁 — `initialize` «한 번»만 답하고 살아 있는다.
//
// ⭐ 왜 실물 프로세스인가: 이 스텁이 있어야 `AcpAgent.start()` 의 «진짜» 스폰·핸드셰이크 경로를
//    돌 수 있고, 그래야 「협상 결과를 관측으로 흘리는 배선」이 실행 경로에 «있는지»를 물 수 있다.
//    ⛔ private 메서드를 직접 부르는 테스트는 그 배선을 지워도 통과한다(Goodhart · 리뷰 must-fix).
// 프레이밍은 ndJSON(줄바꿈 구분) — `src/acp/client.ts` 가 `ndJsonStream` 을 쓴다.

const advertised = process.env.ACP_STUB_CAPS
  ? JSON.parse(process.env.ACP_STUB_CAPS) as Record<string, unknown>
  : { promptCapabilities: { image: true, audio: false }, loadSession: false };

let buffer = '';
process.stdin.on('data', (chunk: Buffer) => {
  buffer += chunk.toString('utf8');
  let index = buffer.indexOf('\n');
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf('\n');
    if (!line) continue;
    let message: {
      id?: number;
      method?: string;
      params?: { clientInfo?: { name?: unknown; version?: unknown } };
    };
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      continue;
    }
    if (message.method === 'initialize' && message.id !== undefined) {
      const clientInfo = message.params?.clientInfo;
      const clientInfoIsValid = typeof clientInfo?.name === 'string'
        && clientInfo.name.length > 0
        && typeof clientInfo?.version === 'string'
        && clientInfo.version.length > 0;
      process.stderr.write(`received initialize clientInfo=${JSON.stringify(clientInfo)}\n`);
      process.stdout.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        ...(process.env.ACP_STUB_REQUIRE_CLIENT_INFO === '1' && !clientInfoIsValid
          ? { error: { code: -32602, message: 'missing field clientInfo' } }
          : { result: { protocolVersion: 1, agentCapabilities: advertised, clientInfo } }),
      })}\n`);
    }
  }
});

// stdin 이 닫히면 종료 — 부모가 stop() 하면 자연히 끝난다.
process.stdin.on('end', () => process.exit(0));
