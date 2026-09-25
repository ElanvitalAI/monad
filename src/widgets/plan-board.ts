// Wave P3a (presentation) · A4-1 — plan-board widget definition.
//
// In-session "plan board" — mirrors `update_plan` steps live. Widget
// is the **asset** layer (parallel to sessionsSidebarWidget); the
// dashboard's chatLines in-place splice runtime
// (`src/dashboard/plan-board-runtime.ts`) is the immediate user-
// visible surface (replaces the old chatLines.push fallback).
//
// Future wave (P3a follow-up) wires this widget into a sidebar /
// pane surface so the operator can pin the plan beside the chat.
// The widget definition stays the same — only the spawn site moves.
//
// Reactive contract:
//   - subscribePlanUpdate fires every time `update_plan` is dispatched
//   - widget's onMount registers the listener; onUnmount disposes it
//   - state.steps reflects the most recent PlanState atomically
//
// Render:
//   - Delegates to renderPlanBoard (pure, already exists from WF2)
//   - Empty plan → empty `[]` (caller renders placeholder)

import type { WidgetDef } from './types.js';
import { renderPlanBoard } from '../code-edit/plan-renderer.js';
import {
  getPlanState,
  subscribePlanUpdate,
  type PlanStep,
} from '../code-edit/plan-tool.js';

export interface PlanBoardWidgetState {
  steps: PlanStep[];
  lastExplanation?: string;
  cursor: number;
  /** Stored on state so onUnmount can dispose the subscription. */
  unsubscribe?: () => void;
}

const planBoardWidget: WidgetDef<PlanBoardWidgetState> = {
  type: 'plan-board',
  description: 'In-session plan board mirroring update_plan steps live.',

  initialState() {
    const s = getPlanState();
    return {
      steps: s.steps,
      ...(s.lastExplanation ? { lastExplanation: s.lastExplanation } : {}),
      cursor: 0,
    };
  },

  onMount(state, ctx) {
    state.unsubscribe = subscribePlanUpdate((next) => {
      ctx.setState({
        steps: next.steps,
        ...(next.lastExplanation
          ? { lastExplanation: next.lastExplanation }
          : { lastExplanation: undefined }),
        // Clamp cursor inside the new step range so the selection
        // doesn't dangle past the end after a step is removed.
        cursor: Math.min(state.cursor, Math.max(0, next.steps.length - 1)),
      });
    });
  },

  onUnmount(state) {
    state.unsubscribe?.();
    state.unsubscribe = undefined;
  },

  render(state, ctx) {
    if (state.steps.length === 0) {
      return [
        fitWidth('No active plan.', ctx.width),
        fitWidth('update_plan emits steps here.', ctx.width),
      ];
    }
    const lines = renderPlanBoard({
      steps: state.steps,
      updatedAt: 0,
      version: 0,
      ...(state.lastExplanation ? { lastExplanation: state.lastExplanation } : {}),
    });
    const fitted = lines.slice(0, ctx.height).map((l) => fitWidth(l, ctx.width));
    return fitted;
  },

  onKey(ev, state) {
    const max = state.steps.length - 1;
    if (max < 0) return { type: 'none' };
    switch (ev.name) {
      case 'j':
      case 'down':
        state.cursor = Math.min(state.cursor + 1, max);
        return { type: 'refresh' };
      case 'k':
      case 'up':
        state.cursor = Math.max(state.cursor - 1, 0);
        return { type: 'refresh' };
      case 'g':
      case 'home':
        state.cursor = 0;
        return { type: 'refresh' };
      case 'G':
      case 'end':
        state.cursor = max;
        return { type: 'refresh' };
      default:
        return { type: 'none' };
    }
  },
};

function fitWidth(line: string, width: number): string {
  if (width <= 0) return line;
  // Cheap pad/truncate — visibleWidth-aware fit lives in tui.ts but
  // renderPlanBoard's lines are short enough that string length ~=
  // visible width for our characters. The widget host's frame
  // re-truncates anyway.
  if (line.length === width) return line;
  if (line.length < width) return line + ' '.repeat(width - line.length);
  return line.slice(0, width);
}

export default planBoardWidget;
