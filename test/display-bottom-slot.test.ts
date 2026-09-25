// ── C-d-1 하단 슬롯 배치 순수 테스트 (2026-07-12) ─────────────────────────────

import { describe, expect, test } from 'bun:test';
import { resolveBottomSlotBounds } from '../src/display/bottom-slot.js';
import { buildPromptFrameFromPromptBottomRow } from '../src/display/prompt-frame.js';

const frame = (promptBottomRow: number, inputHeight = 1) =>
  buildPromptFrameFromPromptBottomRow(promptBottomRow, inputHeight);

describe('resolveBottomSlotBounds', () => {
  test('composer 프레임 바닥(아래 divider)에 바닥 정렬 · 위로 성장', () => {
    // 40행 터미널 · composer 바닥행 34 → bottomDividerRow 35.
    const b = resolveBottomSlotBounds({ termCols: 120, termRows: 40, promptFrame: frame(34), height: 16 });
    expect(b.row + b.height - 1).toBe(35);  // 바닥 = bottomDividerRow
    expect(b.height).toBe(16);
    expect(b.row).toBe(20);
  });

  test('터미널이 낮으면 높이를 줄여 상단 2행을 침범하지 않는다', () => {
    const b = resolveBottomSlotBounds({ termCols: 80, termRows: 14, promptFrame: frame(10), height: 16 });
    expect(b.row).toBeGreaterThanOrEqual(2);
    expect(b.row + b.height - 1).toBeLessThanOrEqual(13);
    expect(b.height).toBeGreaterThanOrEqual(4);
  });

  test('폭은 거의 전폭(여백 4) · 좁은 터미널은 최소 40', () => {
    const wide = resolveBottomSlotBounds({ termCols: 200, termRows: 50, promptFrame: frame(44), height: 14 });
    expect(wide.width).toBe(196);
    const narrow = resolveBottomSlotBounds({ termCols: 42, termRows: 30, promptFrame: frame(24), height: 14 });
    expect(narrow.width).toBe(40);
    expect(narrow.col).toBeGreaterThanOrEqual(1);
  });

  test('멀티라인 composer(inputHeight>1)도 프레임 바닥 기준', () => {
    const f = frame(34, 5); // promptTopRow 30 · bottomDividerRow 35
    const b = resolveBottomSlotBounds({ termCols: 100, termRows: 40, promptFrame: f, height: 12 });
    expect(b.row + b.height - 1).toBe(35);
  });
});
