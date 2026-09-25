/**
 * 터미널 칩이 «이게 무엇인지» 말하게 하는 순수 판정.
 *
 * ⛔⭐ 왜 (대표 2026-08-17): *"preview-1 같은 아이디가 이제는 의미 없지 않나요?"*
 * 📏 그런데 전수로 재니 `preview-1` 은 «의미 없는 이름»이 아니었다 —
 *    `src/dashboard/index.ts:7991` 이 ***데몬 전체에서 단 한 곳***에서
 *    `registerPreviewTerminalForWebTap(previewTerminal, sid, 'preview-1', handle)` 로
 *    ***TUI 프리뷰 페인***을 그 이름에 못 박는다(주석: "so PWA /term peers see the same grid").
 *    반면 `preview-2` 이후는 데몬이 «모르는» 이름이고 PWA 의 `nextDefaultId` 가 지어낸다.
 *
 * ⇒ 📌 그래서 결함은 「이름이 나쁘다」가 아니라 ***「그 이름이 무엇인지 화면이 말하지 않는다」***다.
 *   이름을 바꾸면 TUI↔PWA 접점이 조용히 끊긴다. 대신 «무엇인지»를 붙인다.
 *
 * ⛔ 모르면 «지어내지 않는다» — 아는 것만 말하고 나머지는 id 그대로 둔다.
 */
export type TerminalKindLabel =
  | 'tui-preview'   // TUI 프리뷰 페인의 웹 이름 (데몬이 하드코딩한 접점)
  | 'web-scratch'   // PWA 가 지어낸 스크래치 탭 (preview-2, preview-3, …)
  | 'tui-surface'   // tui:* — 대화형 대시보드 TUI 표면
  | 'human-terminal' // term-* — 사람이 명시적으로 만든 웹 터미널
  | 'web-terminal'  // webterm-* — 레거시 데몬 발급 웹 터미널
  | 'harness-run'   // self_* — 하니스 자율 런의 자식 PTY
  | 'agent'         // agent:* — 서브 에이전트 실행
  | 'pty'           // pty_* — 일반 PTY
  | 'unknown';      // 아는 규칙에 안 걸린다 — 지어내지 않는다

export interface TerminalChipLabel {
  /** 칩에 보이는 짧은 글자. id 자체이거나 사람이 읽는 이름. */
  text: string;
  /** 호버 툴팁 — 「이게 무엇인가」를 문장으로. */
  hint: string;
  kind: TerminalKindLabel;
}

/** ⛔ TUI 프리뷰 페인이 못 박힌 «그» 이름. src/dashboard/index.ts 와 짝이다. */
export const TUI_PREVIEW_TERMINAL_ID = 'preview-1';

export function terminalKindOf(id: string): TerminalKindLabel {
  if (id === TUI_PREVIEW_TERMINAL_ID) return 'tui-preview';
  if (/^preview-\d+$/.test(id)) return 'web-scratch';
  if (id.startsWith('tui:')) return 'tui-surface';
  if (id.startsWith('term-')) return 'human-terminal';
  if (id.startsWith('webterm-')) return 'web-terminal';
  if (id.startsWith('self_')) return 'harness-run';
  if (id.startsWith('agent:')) return 'agent';
  if (id.startsWith('pty_')) return 'pty';
  return 'unknown';
}

/**
 * 칩 라벨을 만든다.
 * @param displayName 데몬이 아는 사람 이름(있을 때만). 없으면 «지어내지 않는다».
 */
export function terminalChipLabel(id: string, displayName?: string | null): TerminalChipLabel {
  const kind = terminalKindOf(id);
  const named = displayName?.trim();
  switch (kind) {
    case 'tui-preview':
      return { text: 'TUI 프리뷰', hint: `TUI 프리뷰 페인의 웹 이름 · ${id}`, kind };
    case 'web-scratch':
      return { text: id, hint: `이 브라우저가 만든 스크래치 터미널 · ${id}`, kind };
    case 'tui-surface':
      return { text: id, hint: `대화형 대시보드 TUI 표면 · ${id}`, kind };
    case 'human-terminal':
      return { text: id, hint: `사람이 만든 웹 터미널 · ${id}`, kind };
    case 'web-terminal':
      return { text: id, hint: `데몬이 발급한 웹 터미널 · ${id}`, kind };
    case 'harness-run':
      return { text: named || id, hint: `하니스 자율 런의 터미널 · ${id}`, kind };
    case 'agent':
      return { text: named || id, hint: `서브 에이전트 실행 · ${id}`, kind };
    case 'pty':
      return { text: named || id, hint: `PTY · ${id}`, kind };
    default:
      // ⛔ 모르는 것을 «아는 척» 하지 않는다.
      return { text: id, hint: `분류를 모르는 터미널 · ${id}`, kind };
  }
}
