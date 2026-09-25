// ── Terminal Matrix — broadcast groups (Phase T4) ──
//
// Tmux's `synchronize-panes` lives at the *group* level here: any
// number of named broadcast groups, each holding a set of
// TerminalIds. A key event / clipboard payload broadcast to a group
// fans out to every alive, non-readonly member.
//
// The bus is pure logic — it looks up TerminalInstances via the
// matrix, skips dead or read-only ones, and calls pty.write() on the
// survivors. No key parsing, no UI: surface adapters (e.g. the
// per-VW input bar in T4b) convert KeyEvents to terminal bytes and
// hand them to `broadcastBytes(group, bytes)`.
//
// Groups are intentionally loose — membership is a tag on the
// instance (instance.broadcastGroups). The bus just queries the
// matrix, so add/remove is idempotent and lock-free.

import type { TerminalRegistry } from './registry.js';
import type { GlobalTerminalId, TerminalInstance } from './types.js';

export interface BroadcastResult {
  readonly group: string;
  readonly delivered: readonly GlobalTerminalId[];
  readonly skippedExited: readonly GlobalTerminalId[];
  readonly skippedReadOnly: readonly GlobalTerminalId[];
  readonly errored: readonly { id: GlobalTerminalId; error: string }[];
}

export class BroadcastBus {
  constructor(private readonly registry: TerminalRegistry) {}

  /** Write raw bytes to every alive, non-readonly member of the
   *  group. Caller is responsible for key-encoding — see the
   *  existing `keyEventToTerminalBytes()` helper in
   *  display/execution-surface.ts for a reusable converter. */
  broadcastBytes(group: string, bytes: string | Buffer): BroadcastResult {
    const payload = typeof bytes === 'string' ? bytes : bytes.toString('utf8');
    const members = this.registry.list({ group, includeExited: true });
    const delivered: GlobalTerminalId[] = [];
    const skippedExited: GlobalTerminalId[] = [];
    const skippedReadOnly: GlobalTerminalId[] = [];
    const errored: { id: GlobalTerminalId; error: string }[] = [];
    for (const inst of members) {
      if (inst.exitCode !== null) { skippedExited.push(inst.id); continue; }
      if (inst.readOnly)           { skippedReadOnly.push(inst.id); continue; }
      try {
        inst.pty.write(payload);
        inst.lastActivityAt = Date.now();
        delivered.push(inst.id);
      } catch (err) {
        errored.push({ id: inst.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { group, delivered, skippedExited, skippedReadOnly, errored };
  }

  /** Send a pre-encoded clipboard payload. For now treats text +
   *  bytes identically — future T4 extension: binary image paste
   *  via OSC 52 or sixel encoding per-terminal. */
  broadcastClipboard(group: string, text: string): BroadcastResult {
    return this.broadcastBytes(group, text);
  }

  /** Iterate group membership — convenience for UI code that wants
   *  to render a member list next to the input bar. */
  members(group: string): TerminalInstance[] {
    return this.registry.list({ group });
  }

  /** Collect the set of groups currently in use across the registry. */
  groups(): string[] {
    const seen = new Set<string>();
    for (const inst of this.registry.list({ includeExited: true })) {
      for (const g of inst.broadcastGroups) seen.add(g);
    }
    return [...seen].sort();
  }
}
