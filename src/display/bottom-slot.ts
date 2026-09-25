// ── 하단 슬롯 결정 뷰 배치 (C-d-1 · 2026-07-12) ──────────────────────────────
//
// codex bottom_pane(view_stack — 뷰가 composer 를 렌더에서 제외) · claude-code
// focusedInputDialog(입력창 언마운트 후 그 자리에 선택 UI) 실측 정렬:
// RESEARCH-input-focus-essential-2026-07-12 §3 C-d-1. 결정 뷰(픽커/승인)를
// 화면 중앙 플로팅이 아니라 **composer 자리(하단)에 교체 배치**한다 —
// 하단 영역의 단일 소유자 규칙. 순수 지오메트리 계산만(페인트/포커스는 호스트).

import type { PromptFrame } from './prompt-frame.js';

export interface BottomSlotBounds { row: number; col: number; width: number; height: number }

/** 결정 뷰의 하단 슬롯 bounds — composer 프레임(위 divider~아래 divider)을 덮으며
 *  부족한 높이는 위(chat 방향)로 확장. 최상단 2행(타이틀 여백)은 침범하지 않는다. */
export function resolveBottomSlotBounds(input: {
  termCols: number;
  termRows: number;
  promptFrame: PromptFrame;
  /** 모달 전체 높이(박스 chrome 포함) — 픽커류는 14~16. */
  height: number;
}): BottomSlotBounds {
  const { termCols, termRows, promptFrame } = input;
  // composer 프레임의 바닥(아래 divider)까지 덮어 스테일 픽셀을 남기지 않는다.
  const anchorBottom = Math.min(
    Math.max(promptFrame.bottomDividerRow, promptFrame.promptBottomRow),
    termRows - 1,
  );
  const height = Math.max(4, Math.min(input.height, anchorBottom - 2));
  const row = Math.max(2, anchorBottom - height + 1);
  // 거의 전폭(양쪽 여백 2) — composer 와 같은 시각적 소유 영역. 좁은 터미널은 최소 40.
  const width = Math.max(40, Math.min(termCols - 4, termCols));
  const col = Math.max(1, Math.floor((termCols - width) / 2) + 1);
  return { row, col, width, height };
}
