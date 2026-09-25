'use client';

import { useContext, useEffect, useState } from 'react';
import type { ChatBlock } from '@/lib/chat-runtime';
import { McpAppFrame } from './McpAppFrame';
import { DaemonContext } from '@/components/providers/DaemonProvider';
import { debugLog } from '@/lib/debug';
import { fetchMcpAppHtml, mcpAppFrameDomains, type McpAppResourceBody } from '@/lib/mcp-app-resource';
import { MCP_TOOL_NAME_SEPARATORS, mcpServerPrefixOf } from '../../../../../../src/tool-runtime/mcp-wire-name';

type McpAppBlockData = Extract<ChatBlock, { kind: 'mcp_app' }>;

/** ⛔⭐⭐⭐ 서버 접두는 `toolName` 에 있고, 구분자는 «둘 다» 온다.
 *
 *  📏 이 함수는 2026-08-21 하루에 «두 번» 틀렸다:
 *    ① `toolId`(툴 «호출» id)를 쪼갰다 — 접두는 거기 없다. `toolName` 이다.
 *    ② `.` 만 찾았다 — 그런데 프로바이더가 툴 이름에 점을 «금지»해서(`^[a-zA-Z0-9_-]+$`)
 *       전선 이름을 `higgsfield__generate_image` 로 바꿨다(#10767). ⇒ 이 함수가 `""` 를 냈고,
 *       그래서 리소스 조회를 «건너뛰어» 위젯 본문이 영영 안 왔다(폴백만 떴다).
 *
 *  ⇒ 📌 ***내가 전선 이름을 바꿀 때 「그 이름을 «읽는» 자리」를 전수로 안 셌다.***
 *    오늘 이 저장소가 열여덟 번 밟은 그 형태다 — 「있는데 그 경로가 안 쓴다」의 쌍둥이:
 *    ***「바꿨는데 읽는 쪽을 안 바꿨다」.***
 *
 *  ⛔⭐ 그래서 이제 구분자를 «여기서 베끼지 않는다» — 이름을 «만드는 쪽»과 같은 모듈에서 읽는다.
 *    구분자가 또 바뀌면 이 파일은 «고칠 것이 없다». 재발 방지의 본체가 그것이다. */
export { MCP_TOOL_NAME_SEPARATORS, mcpServerPrefixOf as mcpAppServerOf };

export function McpAppBlock({ block }: { block: McpAppBlockData }) {
  const server = mcpServerPrefixOf(block.toolName);
  const daemon = useContext(DaemonContext);
  const [fetched, setFetched] = useState<McpAppResourceBody | null>(null);

  // ⭐ Only runs when the tool result did not embed the body. Today's peer does
  //   embed it, so this is the path that would rot unnoticed — see
  //   mcp-app-resource.ts for why it is worth keeping alive.
  useEffect(() => {
    if (block.html || !daemon || !server || !block.screenUrl) return;
    const controller = new AbortController();
    let live = true;
    // ⛔⭐⭐ 렌더 경로가 「임베드인가 조회인가」로 갈리는데 그 축의 계측이 «0» 이었다(2026-08-21).
    //   그래서 「위젯이 늦다」를 봐도 어느 길로 갔는지 알 수가 없었다.
    const startedAt = Date.now();
    debugLog('mcp-app.body.fetch', { server, uri: block.screenUrl, reason: 'not-embedded' });
    void fetchMcpAppHtml(daemon.client, { server, uri: block.screenUrl, signal: controller.signal })
      .then((body) => {
        if (!live) return;
        debugLog('mcp-app.body.fetched', {
          server,
          elapsedMs: Date.now() - startedAt,
          ok: body !== null,
          bytes: body?.html.length ?? 0,
          // ⭐ 「허용 출처를 받았나」 — 못 받으면 CSP 가 전부 거부로 서고 위젯이 죽은 껍데기가 된다.
          connectDomains: body?.connectDomains?.length ?? null,
          resourceDomains: body?.resourceDomains?.length ?? null,
        });
        setFetched(body);
      })
      // ⛔ 던져도 «관측이 사라지지» 않는다. `fetchMcpAppHtml` 은 null 로 닫도록 돼 있지만,
      //   그 계약이 깨지면 이 자리가 조용해지고 「위젯이 안 뜬다」가 다시 진단 불가가 된다.
      .catch((err: unknown) => {
        if (!live) return;
        debugLog('mcp-app.body.fetched', {
          server, elapsedMs: Date.now() - startedAt, ok: false, threw: true,
          reason: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
        });
      });
    return () => { live = false; controller.abort(); };
  }, [block.html, block.screenUrl, daemon, server]);

  const html = block.html ?? fetched?.html ?? undefined;
  // ⛔📏 2026-08-21 라이브: 이 경로로 온 위젯은 허용 출처가 «없어» CSP 가 전부 `'none'` 이 됐고,
  //   그림이 깨지고 「Connecting...」 에서 영영 멈췄다. ⇒ 조회로 받은 목록을 «쓴다».
  //   ⭐ 블록이 이미 아는 것이 우선이다 — 그것이 툴 결과가 «직접» 선언한 값이기 때문이다.
  const { connectDomains, resourceDomains } = mcpAppFrameDomains(block, fetched);

  return (
    <section
      data-monad-block-kind="mcp_app"
      data-monad-tool-id={block.toolId}
      data-monad-tool-name={block.toolName}
      className="rounded border border-border bg-muted/40 px-3 py-2 text-sm"
    >
      <div className="font-medium">{block.toolName}</div>
      <div className="text-xs text-muted-foreground">{block.toolId}</div>
      <div className="mt-1 break-all font-mono text-xs">{block.screenUrl}</div>
      {html && (
        <McpAppFrame
          html={html}
          connectDomains={connectDomains}
          resourceDomains={resourceDomains}
          server={server}
          tool={block.toolName}
          toolCallId={block.toolId}
          toolResult={block.toolResult}
        />
      )}
      {block.fallbackText && (
        <p className="mt-2 whitespace-pre-wrap text-sm">{block.fallbackText}</p>
      )}
    </section>
  );
}
