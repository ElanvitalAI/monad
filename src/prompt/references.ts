// Prompt reference expander — T2-P1.
//
// One entry point for every `@<kind>:<id>` reference in chat input.
// Each registered expander handles a specific token family; the
// overall pipeline composes them in order so new references can be
// added without touching the call site in dashboard.ts.
//
// Supported kinds (T2-P1 landing):
//
//   @term:<id>            — TerminalSessionRegistry session snapshot
//   @term:<id>#<N>        — last N bytes
//   @term:<id>#all        — full render
//
// Planned (T2-P2):
//
//   @pane:<id>            — VirtualWindow pane capture
//   @win:<N>/pane:<id>    — same but qualified
//
// Keeping the expander pipeline here (outside dashboard.ts) so the
// wiring is testable in isolation and the chat submit path stays
// three lines of plumbing.

import { expandTerminalReferences } from './term-reference.js';
import { expandVirtualWindowReferences } from './vw-reference.js';
import type { TerminalSessionRegistry } from '../terminal/session-registry.js';
import type { AddressBook } from '../virtual-windows/addressing.js';
import type { WindowRegistry } from '../virtual-windows/window-registry.js';

export interface PromptReferenceDeps {
  /** TerminalSessionRegistry — powers @term:<id>. Omitted = skip. */
  terminalRegistry?: TerminalSessionRegistry;
  /** AddressBook — powers @pane:<id> + @win:<N>. Omitted = skip. */
  addressBook?: AddressBook;
  /** WindowRegistry — required for pane enumeration (@win:<N> /
   *  @win:<N>#all) and for resolving the live PaneContent. */
  windowRegistry?: WindowRegistry;
}

/** Expand every @<kind>:<id> token in `input` into its structured
 *  payload. Tokens with unknown ids (or kinds not wired up) pass
 *  through untouched so the LLM + user can see what was meant. */
export function expandPromptReferences(
  input: string,
  deps: PromptReferenceDeps,
): string {
  if (!input.includes('@')) return input;
  let out = input;
  if (deps.terminalRegistry) {
    out = expandTerminalReferences(out, deps.terminalRegistry);
  }
  if (deps.addressBook && deps.windowRegistry) {
    const reg = deps.windowRegistry;
    out = expandVirtualWindowReferences(out, {
      addressBook: deps.addressBook,
      paneLookup: (paneId) => {
        const pane = deps.addressBook!.resolvePane(paneId);
        if (!pane) return null;
        const window = reg.get(pane.windowId);
        const content = window?.getPane(paneId) ?? null;
        if (!content) return null;
        return { capture: () => content.capture(), kind: content.kind };
      },
      listPanes: (winId) => {
        const window = reg.get(winId);
        if (!window) return [];
        return window.listPanes().map((p) => ({ id: p.id, kind: p.content.kind }));
      },
    });
  }
  return out;
}
