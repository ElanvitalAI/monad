'use client';

import { useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { buildMcpAppCsp } from '@/lib/mcp-app-csp';
import { attachMcpAppFrame, getMcpAppBridge } from '@/lib/mcp-app-bridge-host';
import { DaemonContext } from '@/components/providers/DaemonProvider';

export interface McpAppFrameProps {
  html: string;
  connectDomains?: readonly unknown[];
  resourceDomains?: readonly unknown[];
  /** MCP server this widget belongs to. The host knows it; the widget never
   *  gets to name it. */
  server?: string;
  /** ⛔📏 2026-08-21: 이 둘을 안 넘기고 있었다. 브리지는 `frame.tool === published.tool` 로
   *  결과를 라우팅하는데, 등록에 `tool` 이 없으면 그 비교가 «영영» 안 맞는다 — 푸시가 도착할 수 없다. */
  tool?: string;
  toolCallId?: string;
  /** 이 화면을 만든 툴 호출의 결과. 규범상 호스트가 «초기 상태»로 밀어야 하는 값이다. */
  toolResult?: unknown;
}

export function McpAppFrame({ html, connectDomains, resourceDomains, server, tool, toolCallId, toolResult }: McpAppFrameProps) {
  const csp = buildMcpAppCsp({ connectDomains, resourceDomains });
  const srcDoc = `<meta http-equiv="Content-Security-Policy" content="${csp}">${html}`;
  const ref = useRef<HTMLIFrameElement | null>(null);
  const frameId = useId();
  // Read the context directly rather than through `useDaemon()`: this block
  // also renders where no provider is mounted (string-render tests, routes
  // outside the daemon shell), and a widget that cannot reach the daemon must
  // still draw — sandboxed and inert — instead of throwing the message away.
  const daemon = useContext(DaemonContext);
  // ⛔⭐ 대표 2026-08-21: *"처음부터 큰 빈 영역이 자리 잡는 구조가 이상하다."*
  //   📏 실측: 고정 `h-96`(384px)이 «내용과 무관하게» 자리를 잡았고, 위젯이 채우지 못하면
  //     그 빈 상자가 대화 한복판에 남았다.
  //   ⇒ 처음엔 «작게» 두고, 위젯이 실제로 뜨면(load) 그때 펼친다.
  //   ⛔ 「띄웠다」와 「보여 줄 것이 있다」는 다른 값이다 — 후자를 기다린다.
  const [loaded, setLoaded] = useState(false);

  // ⛔ Registration is bound to the frame's `load`, not to mount. Before the
  //   srcDoc document commits, `contentWindow` is a transient about:blank
  //   Window; registering that one would pin the bridge to a Window the widget
  //   never posts from, and every later message would read as untrusted-source.
  // ⛔📏 무인 리뷰(2026-08-21 · PR #10861)가 잡았다: 부착이 `onLoad` «안»에만 있으면
  //   iframe 이 다시 안 뜨는 prop 변경(같은 화면에 새 결과 등)에서 옛 바인딩이 그대로 남는다.
  //   ⇒ 부착을 «효과»로 옮겨 바인딩이 바뀌면 정리하고 다시 붙인다. `onLoad` 는 창을 «건네주기»만 한다.
  const [contentWindow, setContentWindow] = useState<Window | null>(null);
  const onLoad = useCallback(() => {
    setLoaded(true);
    setContentWindow(ref.current?.contentWindow ?? null);
  }, []);

  useEffect(() => {
    if (!contentWindow || !daemon) return;
    // ⭐ 배선 자체는 `attachMcpAppFrame` 이 갖는다 — 렌더 콜백 안에 두면 시험이 «못 문다».
    //   브리지가 위젯의 준비 신호까지 결과를 큐에 붙잡아 두므로 여기서 바로 밀어도 안 버려진다.
    return attachMcpAppFrame(getMcpAppBridge(daemon.client, window), {
      frameId,
      source: contentWindow,
      server: server ?? '',
      ...(tool !== undefined ? { tool } : {}),
      ...(toolCallId !== undefined ? { toolCallId } : {}),
      ...(toolResult !== undefined ? { toolResult } : {}),
    });
  }, [contentWindow, daemon, frameId, server, tool, toolCallId, toolResult]);

  return (
    <iframe
      ref={ref}
      data-elanous-mcp-app-frame="true"
      // Rendered so the host-side server pairing is observable in a string
      // render — the field it comes from has already been wrong once.
      data-elanous-mcp-server={server ?? ''}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      title="MCP App"
      onLoad={onLoad}
      className={`mt-2 w-full rounded border border-border bg-background transition-[height] ${loaded ? 'h-96' : 'h-10'}`}
    />
  );
}
