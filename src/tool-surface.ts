// BrowserNavigate and BrowserRead reach ACP through
// `boot/daemon-tools/index.ts::toolSurface('webterm')`, which explicitly joins
// their runtimes without marking them as MCP proxies. BrowserOpen,
// BrowserScreenshot, and BrowserClose remain unavailable because their session
// lifecycle is process-capable; do not add a host here because that would expose
// every catalog entry.
// 🆕 `chat` (2026-09-07 · 대표) — PWA·안드로이드·iOS 챗이 «공통으로» 도는 표면.
//   ⛔ 서피스마다 값을 만들지 «않는다»(`pwa-chat`·`android-chat`…). 대표 이 정의한 호스트의
//      가르는 기준은 ***「PTY 를 쓸 수 있나」***이고, 그 셋은 그 기준에서 «전부 같다».
//      기기를 가르는 축은 여기가 아니라 `SessionSurface`(사람이 어디서 말했나)다.
//   📄 축 결정표 = 내부 문서 `MANUAL-surface-character-role-2026-08-15` §1
//   ⚠️ 이 값을 더해도 «아무것도 자동으로 노출되지 않는다» — 카탈로그 항목이 자기 `host` 에
//      'chat' 을 적어야만 실린다. (위 브라우저 툴 주의문은 그 「항목에 적는 것」을 말한다.)
export const NATIVE_TOOL_HOSTS = ['skill', 'tui', 'mcp', 'chat', 'all'] as const;

export type NativeToolHost = (typeof NATIVE_TOOL_HOSTS)[number];

const TOOL_HOSTS = ['skill', 'tui', 'mcp', 'chat'] as const;

export type ToolHost = Exclude<NativeToolHost, 'all'>;

type Assert<T extends true> = T;
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;

type _ToolHostsMatchNativeHostsWithoutAll = Assert<
  Equal<(typeof TOOL_HOSTS)[number], ToolHost>
>;
