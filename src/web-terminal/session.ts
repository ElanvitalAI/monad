// WT-S-1 placeholder — `WebTerminalSession` will land in WT-S-2 as the
// substrate adapter that exposes a TerminalInstance-shaped interface
// over the existing PreviewTerminal. Today read-only attach goes
// straight from PreviewTerminal.addRawOutputTap → AcpServerHandle, no
// session object needed; this stub reserves the module path so the
// follow-up arc lands on a stable import.

export interface WebTerminalSessionLike {
  /** Stable per-session terminal id. */
  readonly terminalId: string;
  /** Daemon session id this terminal is multiplexed onto. */
  readonly sessionId: string;
}
