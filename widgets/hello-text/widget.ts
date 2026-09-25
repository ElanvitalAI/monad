// Hello-text scaffold widget — T6-K9.
//
// Minimal widget authoring example. Copy this directory to
// `widgets/<your-name>/`, rename the `type`, adjust render().
//
// Contract recap:
//   • render() MUST return exactly ctx.height rows
//   • Each row should not exceed ctx.width cells (ANSI-aware
//     truncation recommended via tui.visibleWidth)
//   • render is pure — side effects go in onKey / onMouse
//
// WR-4 stateless · no observation hooks needed (S3.C · 2026-04-27).
// Scaffold widget — `presses` counter is illustrative state for
// authoring docs, not a meaningful surface for LLM observation or
// timeline replay. New widgets copying this scaffold should add the
// WR observation hooks (state-change emit · state-hash · describe-
// surface) when their state genuinely matters to a recorder or agent.

import type { WidgetDef } from '../../src/widgets/types.js';
import { C, visibleWidth } from '../../src/tui.js';

export interface HelloTextState {
  message: string;
  presses: number;
}

export interface HelloTextConfig {
  message?: string;
}

function clampRow(line: string, width: number): string {
  const w = visibleWidth(line);
  if (w >= width) return line.slice(0, width);
  return line + ' '.repeat(width - w);
}

const helloTextWidget: WidgetDef<HelloTextState, HelloTextConfig> = {
  type: 'hello-text',
  description: 'Static text block — scaffold widget.',
  defaultCharacter: 'Hello',

  initialState(config): HelloTextState {
    return {
      message: config?.message ?? 'Hello, world!',
      presses: 0,
    };
  },

  render(state, ctx, character) {
    const rows: string[] = [];
    const title = clampRow(C.accent(`${character} `), ctx.width);
    rows.push(title);
    if (ctx.height > 1) {
      rows.push(clampRow('', ctx.width));
    }
    if (ctx.height > 2) {
      rows.push(clampRow(C.text(state.message), ctx.width));
    }
    if (ctx.height > 3) {
      rows.push(clampRow(C.muted(`enter pressed ${state.presses} time${state.presses === 1 ? '' : 's'}`), ctx.width));
    }
    while (rows.length < ctx.height) rows.push(clampRow('', ctx.width));
    return rows;
  },

  onKey(ev, state, ctx) {
    if (ev.name === 'enter') {
      ctx.setState({ presses: state.presses + 1 } as Partial<HelloTextState>);
      return { type: 'refresh' };
    }
    return { type: 'none' };
  },

  onMouse(ev, state, ctx) {
    if (ev.type === 'click' || ev.type === 'double-click') {
      ctx.setState({ presses: state.presses + 1 } as Partial<HelloTextState>);
      return { type: 'refresh' };
    }
    return { type: 'none' };
  },

  configSchema() {
    return {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Text body displayed below the title.' },
      },
      additionalProperties: false,
    };
  },
};

export default helloTextWidget;
