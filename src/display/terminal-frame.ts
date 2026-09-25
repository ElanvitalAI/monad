// Shared terminal-render primitive.
//
// A TerminalRenderFrame is an already-ANSI-styled block of lines
// that can be displayed in any surface (modal / scratch / preview
// / plugin / snapshot history). It's the common unit for:
//
//   • transient modals   (showTransientTerminalModal)
//   • file previews      (showPreviewModal)
//   • PTY snapshots      (capturePreviewTerminalFrame)
//   • tool output        (plugin-produced rich output)
//
// Invariant: lines[] carries ANSI already, so consumers must NOT
// word-wrap or re-encode. `preformatted: true` makes that contract
// explicit for widget adapters (e.g. markdown widget with
// preformatted=true).

export interface TerminalRenderFrame {
  /** Optional title painted in the modal border. */
  title?: string;
  /** ANSI-styled lines. Already width-fitted for preferredCols. */
  lines: string[];
  /** Declares the lines carry ANSI and must not be re-wrapped. */
  preformatted: true;
  /** Hint for renderers; ignored if the surface has a fixed size. */
  preferredCols?: number;
  preferredRows?: number;
  /** Transient modal auto-dismiss delay. 0 or undefined = persistent. */
  ttlMs?: number;
  /** Where the frame came from. Purely informational (used by
   *  debug panes + history). */
  source?: 'pty' | 'image' | 'tool' | 'plugin' | 'snapshot';
}
