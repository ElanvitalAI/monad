import {
  buildPromptFrameFromPromptBottomRow,
  fallbackPromptFrame,
  type PromptFrame,
} from '../../display/prompt-frame.js';

export interface CachedPromptFrame {
  termRows: number;
  frame: PromptFrame;
}

export class DashboardStateStore {
  private inputLines = 1;
  private composedPromptFrame: CachedPromptFrame | null = null;

  getInputLines(): number {
    return this.inputLines;
  }

  setInputLines(next: number): boolean {
    if (next === this.inputLines) return false;
    this.inputLines = next;
    return true;
  }

  resetInputLines(): void {
    this.inputLines = 1;
  }

  getCachedPromptFrame(): CachedPromptFrame | null {
    return this.composedPromptFrame;
  }

  setComposedPromptFrame(termRows: number, frame: PromptFrame): void {
    this.composedPromptFrame = { termRows, frame };
  }

  getFallbackPromptFrame(termRows: number): PromptFrame {
    return fallbackPromptFrame(termRows, this.inputLines);
  }

  getLayoutPromptFrame(termRows: number): PromptFrame {
    const cached = this.composedPromptFrame;
    if (cached && cached.termRows === termRows && cached.frame.inputHeight === this.inputLines) {
      return cached.frame;
    }
    return this.getFallbackPromptFrame(termRows);
  }

  getCurrentPromptFrame(termRows: number): PromptFrame {
    const cached = this.composedPromptFrame;
    if (cached && cached.termRows === termRows) {
      return buildPromptFrameFromPromptBottomRow(cached.frame.promptBottomRow, this.inputLines);
    }
    return this.getFallbackPromptFrame(termRows);
  }
}
