// ── Terminal Matrix — unified registry (Phase T1) ──
//
// Single source of truth for "every PTY the app owns." During T1 this
// coexists with TerminalSessionRegistry: matrix adopts each session
// as a TerminalInstance and mirrors placement + exit state. T2 will
// pull placement transitions into the matrix exclusively.
//
// Scope intentionally narrow this phase:
//   • create + read + subscribe API
//   • placement tracking (mutation only — actual surface swap lands in T2)
//   • broadcast-group membership set (fanout wiring in T4)
//   • read-only flag (enforcement in T7)
//   • element-registry dual-write: every instance also published as
//     `term:<id>` so the existing `session:<id>` subscribers keep
//     working while new tools target the unified prefix.
//
// Zero behavioral change guaranteed: matrix.spawn() delegates to
// sessionRegistry.spawn() and lifts the resulting PTY. Tests below
// lock the wrapping contract.

import { posixShellHint, requirePosixShell } from '../platform/default-shell.js';
import type { TerminalSession, TerminalSessionRegistry } from '../terminal/session-registry.js';
import { resolveTransport } from './transport.js';
import type { ChannelBus } from './channel-bus.js';
import { detectAgentFromSpec } from '../agent-detect.js';
import type { SessionUri } from '../mss/uri/brand.js';
import type {
  GlobalTerminalId,
  TerminalCharacter,
  TerminalEvent,
  TerminalInstance,
  TerminalListFilter,
  TerminalPlacement,
  TerminalSpawnSpec,
  TerminalTransport,
  TerminalVisibility,
} from './types.js';
import { DEFAULT_CHARACTER, DEFAULT_PLACEMENT, DEFAULT_TRANSPORT } from './types.js';

export interface TerminalRegistryDeps {
  /** Existing session registry. T1 uses it for PTY lifecycle; T2+
   *  pulls placement/transition logic into matrix but keeps session
   *  registry around as legacy facade for backwards-compat. */
  sessionRegistry: TerminalSessionRegistry;
  /** Viewport size — handed to session registry on spawn. */
  termSize: () => { cols: number; rows: number };
  now?: () => number;
  /** T7c2 — optional channel bus for `pipeToChannel`. When omitted
   *  the matrix falls back to importing `getChannelBus()` from the
   *  singleton at pipe-time, but tests inject their own bus so the
   *  dep is here for clarity. */
  channelBus?: ChannelBus;
}

export interface PipeHandle {
  readonly id: number;
  readonly terminalId: GlobalTerminalId;
  readonly channel: string;
  readonly lineMode: boolean;
  unsubscribe(): void;
}

/** Adapter plugged in by subsystems (preview, VW) to handle
 *  placement transitions the matrix itself can't wire. The matrix
 *  calls `canHandle` on every registered adapter in order; the
 *  first to return true owns the transition via `apply`. */
export interface PlacementTransitionAdapter {
  readonly name: string;
  canHandle(from: TerminalPlacement, to: TerminalPlacement): boolean;
  apply(instance: TerminalInstance, from: TerminalPlacement, to: TerminalPlacement): void;
}

export class TerminalRegistry {
  private readonly instances = new Map<GlobalTerminalId, TerminalInstance>();
  private readonly bySession = new Map<string, GlobalTerminalId>();
  private readonly subscribers = new Set<(ev: TerminalEvent) => void>();
  private readonly transitionAdapters: PlacementTransitionAdapter[] = [];
  private readonly pipeHandles = new Map<number, PipeHandle>();
  private readonly now: () => number;
  private idCounter = 1;
  private nextPipeId = 1;
  private sessionSubscription: (() => void) | null = null;
  /** spawn() relays through sessionRegistry.spawn() which fires the
   *  'spawned' event synchronously inside the call. We stash the
   *  caller's spec here so the event handler's adoptSession() picks
   *  it up — cleaner than re-adopting afterward and fighting the
   *  "already in bySession" guard. */
  private pendingSpawnSpec: TerminalSpawnSpec | null = null;

  constructor(private readonly deps: TerminalRegistryDeps) {
    this.now = deps.now ?? (() => Date.now());
    // Mirror session registry events into matrix events. Existing
    // dashboard code spawns through sessionRegistry.spawn() directly
    // for the foreseeable future; this subscription catches those
    // so the matrix view stays consistent without forcing a
    // lockstep migration of every call site.
    this.sessionSubscription = this.deps.sessionRegistry.subscribe((ev) => {
      const session = ev.session;
      if (ev.type === 'spawned') {
        if (!this.bySession.has(session.id)) {
          this.adoptSession(session, this.pendingSpawnSpec ?? undefined);
        }
      } else {
        const instanceId = this.bySession.get(session.id);
        if (!instanceId) return;
        const instance = this.instances.get(instanceId);
        if (!instance) return;
        if (ev.type === 'attached') {
          this.updatePlacement(instance, { kind: 'modal', modalId: session.modal?.id ?? session.id });
        } else if (ev.type === 'detached') {
          this.updatePlacement(instance, { kind: 'background' });
        } else if (ev.type === 'exited') {
          instance.exitCode = session.exitCode;
          instance.lastActivityAt = this.now();
          this.emit({ type: 'exited', instance, code: session.exitCode ?? 0 });
        } else if (ev.type === 'killed') {
          instance.exitCode = session.exitCode ?? -1;
          this.emit({ type: 'killed', instance });
        } else if (ev.type === 'attention') {
          instance.attentionLevel = Math.max(instance.attentionLevel, ev.level) as 0 | 1 | 2 | 3;
          this.emit({ type: 'attention', instance, level: ev.level });
        }
      }
    });
  }

  /** Spawn a new terminal. Internally delegates to sessionRegistry
   *  for PTY lifecycle during T1 migration; T2 takes ownership. */
  spawn(spec: TerminalSpawnSpec): TerminalInstance {
    const { cols, rows } = this.deps.termSize();
    this.pendingSpawnSpec = spec;
    try {
      // Resolve transport → (shell, args, env) so remote (tailscale /
      // ssh) transports run the shell on the target host instead of
      // locally. Local transport resolves to the user's $SHELL +
      // character-specific program overrides.
      const transport = spec.transport ?? DEFAULT_TRANSPORT;
      const character = spec.character ?? DEFAULT_CHARACTER;
      const needsLocalShell = transport.kind === 'local' && character.kind === 'shell' && !character.shell;
      const resolved = resolveTransport(transport, {
        character,
        defaultShell: needsLocalShell ? requirePosixShell('/bin/bash') : posixShellHint('/bin/bash'),
      });
      const session = this.deps.sessionRegistry.spawn(
        {
          title: spec.title,
          cwd: spec.cwd,
          command: spec.command,
          shell: resolved.shell,
          shellArgs: resolved.args,
          kind: this.characterToLegacyKind(spec.character ?? DEFAULT_CHARACTER),
          agentBrand: this.characterToAgentBrand(spec.character ?? DEFAULT_CHARACTER),
          env: { ...(spec.env ?? {}), ...resolved.env },
        },
        { termCols: cols, termRows: rows },
      );
      const instance = this.getByLegacySessionId(session.id);
      if (instance) return instance;
      // Subscription hadn't adopted (shouldn't happen, but belt+braces) —
      // run adoptSession directly with the pending spec.
      return this.adoptSession(session, spec);
    } finally {
      this.pendingSpawnSpec = null;
    }
  }

  get(id: GlobalTerminalId): TerminalInstance | undefined {
    return this.instances.get(id);
  }

  /** Resolve by legacy session id — convenience for bridge code
   *  that still holds onto TerminalSession references. */
  getByLegacySessionId(sessionId: string): TerminalInstance | undefined {
    const id = this.bySession.get(sessionId);
    return id ? this.instances.get(id) : undefined;
  }

  /** MSS M1.1 Phase C1 — typed alias of `getByLegacySessionId` that
   *  accepts the `SessionUri` brand. Terminal sessions still store
   *  their ids as plain strings (TerminalSession.id predates the URI
   *  migration), but callers holding a minted `SessionUri` can lookup
   *  without an unsafe cast back to `string`. Runtime behaviour is
   *  identical to `getByLegacySessionId`. */
  getBySessionUri(uri: SessionUri): TerminalInstance | undefined {
    return this.getByLegacySessionId(uri);
  }

  list(filter?: TerminalListFilter): TerminalInstance[] {
    const out: TerminalInstance[] = [];
    for (const inst of this.instances.values()) {
      if (filter?.transport && inst.transport.kind !== filter.transport) continue;
      if (filter?.characterKind && inst.character.kind !== filter.characterKind) continue;
      if (filter?.placementKind && inst.placement.kind !== filter.placementKind) continue;
      if (filter?.group && !inst.broadcastGroups.has(filter.group)) continue;
      if (!filter?.includeExited && inst.exitCode !== null) continue;
      out.push(inst);
    }
    return out;
  }

  subscribe(cb: (ev: TerminalEvent) => void): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  /** Update an instance's placement metadata only. Does NOT swap the
   *  surface — use `move()` for the full transition. Exposed so
   *  surface adapters can notify the matrix after they've finished
   *  their own side-effects (e.g. coordinator pushModal). */
  setPlacement(id: GlobalTerminalId, placement: TerminalPlacement): void {
    const inst = this.instances.get(id);
    if (!inst) return;
    this.updatePlacement(inst, placement);
  }

  /** PV1/PV2 — mutate visibility. When flipping `both`/`user` → `llm-only`
   *  and the instance is currently on a user-facing placement, we
   *  detach (move to background) so the UI stops rendering it. The
   *  flip in the other direction is a no-op on placement — the caller
   *  must explicitly surface it via move(). */
  setVisibility(id: GlobalTerminalId, visibility: TerminalVisibility): void {
    const inst = this.instances.get(id);
    if (!inst || inst.visibility === visibility) return;
    inst.visibility = visibility;
    if (visibility === 'llm-only' && inst.placement.kind !== 'background') {
      try { this.move(id, { kind: 'background' }); } catch { /* best-effort */ }
    }
  }

  /** Enumerate placements the user can currently interact with —
   *  skips instances marked `llm-only`. Used by UI pickers so invisible
   *  PTYs don't show up in the modal list. snapshot()/poll surfaces
   *  keep working on the full instance set. */
  listUserVisible(): TerminalInstance[] {
    return [...this.instances.values()].filter(i => i.visibility !== 'llm-only');
  }

  /** Shortcut — list every terminal currently bound to a given
   *  virtual window. Enables multi-split UIs to enumerate their own
   *  slot inventory without tracking placement separately. Ordering
   *  follows spawn order (matrix Map insertion order). */
  listForWindow(windowId: string): TerminalInstance[] {
    const out: TerminalInstance[] = [];
    for (const inst of this.instances.values()) {
      if (inst.placement.kind === 'vw' && inst.placement.windowId === windowId) {
        out.push(inst);
      }
    }
    return out;
  }

  /** Transition a terminal between placements without respawning
   *  the PTY. T2 wires background ↔ modal natively through the
   *  underlying session registry; T2b adds preview transitions via
   *  a PreviewSlotAdapter; T3 adds VW transitions via the VW
   *  registry. Returns the instance on success, throws on an
   *  unsupported transition so callers can offer a helpful message. */
  move(id: GlobalTerminalId, to: TerminalPlacement): TerminalInstance {
    const inst = this.instances.get(id);
    if (!inst) throw new Error(`terminal not found: ${id}`);
    if (inst.exitCode !== null) throw new Error(`terminal already exited: ${id}`);
    // PV2 — llm-only terminals never acquire a user-facing placement.
    // background is the only legal target; callers trying to surface
    // them hit this guard rather than silently going through. snapshot
    // / PtyShellPoll continue to work regardless.
    if (inst.visibility === 'llm-only' && to.kind !== 'background') {
      throw new Error(
        `terminal ${id} is llm-only (invisible to user) — cannot move to ${to.kind}. `
        + `Use registry.setVisibility(id, 'both') first if the user should see it.`,
      );
    }
    if (placementEquals(inst.placement, to)) return inst;

    const from = inst.placement;
    // Background ↔ Modal — the one transition supported at T2 without
    // additional adapters. Other combinations delegate to pluggable
    // adapters registered below; if none handle it we throw so the
    // caller knows to land the adapter (preview: T2b, vw: T3).
    if (from.kind === 'modal' && to.kind === 'background') {
      if (!inst.legacySessionId) throw new Error(`no legacy session for ${id}`);
      this.deps.sessionRegistry.detach(inst.legacySessionId);
      return inst;
    }
    if (from.kind === 'background' && to.kind === 'modal') {
      if (!inst.legacySessionId) throw new Error(`no legacy session for ${id}`);
      const { cols, rows } = this.deps.termSize();
      this.deps.sessionRegistry.attach(inst.legacySessionId, { termCols: cols, termRows: rows });
      return inst;
    }

    // Pluggable transitions — first adapter that accepts wins.
    for (const adapter of this.transitionAdapters) {
      if (adapter.canHandle(from, to)) {
        adapter.apply(inst, from, to);
        this.updatePlacement(inst, to);
        return inst;
      }
    }

    throw new Error(
      `transition not supported yet: ${from.kind} → ${to.kind} ` +
      `(preview lands in T2b, vw in T3; register a PlacementTransitionAdapter to unblock earlier)`,
    );
  }

  /** Register a custom placement adapter. T2b / T3 use this to
   *  graft preview and vw transitions into the move() pipeline
   *  without the matrix depending on either subsystem. */
  registerTransitionAdapter(adapter: PlacementTransitionAdapter): () => void {
    this.transitionAdapters.push(adapter);
    return () => {
      const i = this.transitionAdapters.indexOf(adapter);
      if (i >= 0) this.transitionAdapters.splice(i, 1);
    };
  }

  recharacter(id: GlobalTerminalId, character: TerminalCharacter): void {
    const inst = this.instances.get(id);
    if (!inst) return;
    const prev = inst.character;
    inst.character = character;
    inst.lastActivityAt = this.now();
    this.emit({ type: 'character', instance: inst, prev });
  }

  setReadOnly(id: GlobalTerminalId, readOnly: boolean): void {
    const inst = this.instances.get(id);
    if (!inst || inst.readOnly === readOnly) return;
    const prev = inst.readOnly;
    inst.readOnly = readOnly;
    this.emit({ type: 'readonly', instance: inst, prev });
  }

  joinGroup(id: GlobalTerminalId, group: string): void {
    const inst = this.instances.get(id);
    if (!inst) return;
    if (inst.broadcastGroups.has(group)) return;
    inst.broadcastGroups.add(group);
    this.emit({ type: 'group:join', instance: inst, group });
  }

  leaveGroup(id: GlobalTerminalId, group: string): void {
    const inst = this.instances.get(id);
    if (!inst) return;
    if (!inst.broadcastGroups.has(group)) return;
    inst.broadcastGroups.delete(group);
    this.emit({ type: 'group:leave', instance: inst, group });
  }

  /** T7c2 — publish a terminal's stdout onto a ChannelBus topic.
   *  Returns a PipeHandle whose `.unsubscribe()` detaches the tap +
   *  stops further publishing. Each matrix registry instance maintains
   *  its own counter so pipe ids are unique per-registry.
   *
   *  lineMode=true buffers chunks until a '\n' is seen and emits one
   *  channel message per line (ANSI-stripping left to the
   *  subscriber); lineMode=false (default) publishes each raw chunk
   *  as-is, which is what you want for tee-to-file or tail-to-modal
   *  flows that don't care about line framing. */
  pipeToChannel(
    terminalId: GlobalTerminalId,
    channel: string,
    opts: { lineMode?: boolean } = {},
  ): PipeHandle {
    const inst = this.instances.get(terminalId);
    if (!inst) throw new Error(`terminal not found: ${terminalId}`);
    const bus = this.deps.channelBus ?? this.resolveChannelBus();
    if (!bus) throw new Error('channelBus not available — init matrix with deps.channelBus or call initTerminalMatrix()');
    const lineMode = opts.lineMode === true;
    const pty = inst.pty as unknown as {
      addRawOutputTap?: (cb: (chunk: string) => void) => () => void;
    };
    if (typeof pty.addRawOutputTap !== 'function') {
      throw new Error('PreviewTerminal lacks addRawOutputTap — upgrade required (T7c1)');
    }
    let lineBuf = '';
    const publish = (payload: string): void => {
      bus.publish(channel, { from: inst.id, payload });
    };
    const detach = pty.addRawOutputTap((chunk) => {
      if (!lineMode) {
        publish(chunk);
        return;
      }
      lineBuf += chunk;
      let idx: number;
      while ((idx = lineBuf.indexOf('\n')) >= 0) {
        const line = lineBuf.slice(0, idx);
        lineBuf = lineBuf.slice(idx + 1);
        // Strip trailing \r so CRLF-terminated lines publish cleanly.
        publish(line.endsWith('\r') ? line.slice(0, -1) : line);
      }
    });
    const id = this.nextPipeId++;
    const handle: PipeHandle = {
      id,
      terminalId,
      channel,
      lineMode,
      unsubscribe: () => {
        detach();
        // Flush any buffered partial line in line-mode so we don't
        // silently drop last-line-without-newline output.
        if (lineMode && lineBuf.length > 0) {
          try { bus.publish(channel, { from: inst.id, payload: lineBuf }); }
          catch { /* ignore */ }
          lineBuf = '';
        }
        this.pipeHandles.delete(id);
      },
    };
    this.pipeHandles.set(id, handle);
    return handle;
  }

  /** T7c2 — list every active pipe. Useful for `/term pipe list` and
   *  LLM audit tooling. */
  listPipes(): readonly PipeHandle[] {
    return [...this.pipeHandles.values()];
  }

  private resolveChannelBus(): ChannelBus | null {
    // Lazy-import to keep tests that only use the registry free of
    // the channel-bus singleton.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('./index.js');
      return typeof mod.getChannelBus === 'function' ? mod.getChannelBus() : null;
    } catch {
      return null;
    }
  }

  /** Kill the PTY. Delegates to sessionRegistry during T1. */
  kill(id: GlobalTerminalId, signal: NodeJS.Signals = 'SIGTERM'): void {
    const inst = this.instances.get(id);
    if (!inst?.legacySessionId) return;
    this.deps.sessionRegistry.kill(inst.legacySessionId, signal);
  }

  /** Write bytes into a terminal's PTY with matrix-level enforcement:
   *   • read-only → dropped, returns `{ delivered: false, reason: 'readonly' }`
   *   • exited    → dropped, returns `{ delivered: false, reason: 'exited' }`
   *   • unknown id → throws
   *  Surfaces that respect placement/readonly semantics should call
   *  this instead of `inst.pty.write()` directly. Legacy modal
   *  surfaces still write directly today — migration happens in the
   *  surface refactor phase. */
  writeTo(id: GlobalTerminalId, bytes: string | Buffer): { delivered: boolean; reason?: 'readonly' | 'exited' | 'error'; error?: string } {
    const inst = this.instances.get(id);
    if (!inst) throw new Error(`terminal not found: ${id}`);
    if (inst.exitCode !== null) return { delivered: false, reason: 'exited' };
    if (inst.readOnly)           return { delivered: false, reason: 'readonly' };
    const payload = typeof bytes === 'string' ? bytes : bytes.toString('utf8');
    try {
      inst.pty.write(payload);
      inst.lastActivityAt = this.now();
      return { delivered: true };
    } catch (err) {
      return { delivered: false, reason: 'error', error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Swap the character + optionally re-exec the running program
   *  so the PTY is now hosting the new character's shell / agent.
   *  Passing `reexec:false` (default true) just updates metadata
   *  without touching the PTY — useful when the shell is already
   *  running the right binary but the label/UI needs to catch up. */
  recharacterAndReexec(
    id: GlobalTerminalId,
    character: TerminalCharacter,
    opts: { reexec?: boolean } = {},
  ): { reexeced: boolean } {
    const inst = this.instances.get(id);
    if (!inst) throw new Error(`terminal not found: ${id}`);
    this.recharacter(id, character);
    const reexec = opts.reexec ?? true;
    if (!reexec || inst.exitCode !== null || inst.readOnly) {
      return { reexeced: false };
    }
    // Build an `exec <cmd>` line that replaces the currently running
    // shell with the new character's binary. This preserves the PTY
    // (cursor, scrollback) while handing control over. If character
    // is shell and defaultShell matches, we do nothing.
    const cmd = buildReexecCommand(character);
    if (!cmd) return { reexeced: false };
    try {
      inst.pty.write(`exec ${cmd}\r`);
      inst.lastActivityAt = this.now();
      return { reexeced: true };
    } catch {
      return { reexeced: false };
    }
  }

  /** Tear down observers. Tests call this between cases. */
  dispose(): void {
    this.sessionSubscription?.();
    this.sessionSubscription = null;
    this.subscribers.clear();
  }

  // ── internals ──────────────────────────────────────────────

  private adoptSession(session: TerminalSession, spec?: TerminalSpawnSpec): TerminalInstance {
    const existingId = this.bySession.get(session.id);
    if (existingId) {
      const existing = this.instances.get(existingId);
      if (existing) return existing;
    }
    const id = `term:${this.idCounter++}`;
    const baseCharacter = spec?.character ?? this.inferCharacter(session);
    const transport = spec?.transport ?? DEFAULT_TRANSPORT;
    const placement = spec?.placement ?? this.inferPlacement(session);
    // UA2 — stamp metadata.agentKind automatically whenever the caller
    // didn't pin one. Upgrade the character when the inferred default
    // was `shell` but the spawn spec's command string reveals a known
    // coding agent (e.g. `command: "claude"`). Callers that explicitly
    // set metadata.agentKind (including to 'shell') are respected.
    const baseMetadata = spec?.metadata ? { ...spec.metadata } : {};
    let character = baseCharacter;
    let metadata = baseMetadata;
    if (metadata['agentKind'] === undefined) {
      const detected = detectAgentFromSpec({ character: baseCharacter, command: spec?.command });
      metadata = { ...metadata, agentKind: detected.agentKind };
      if (baseCharacter.kind === 'shell' && detected.character.kind !== 'shell') {
        character = detected.character;
      }
    }
    const instance: TerminalInstance = {
      id,
      title: session.title,
      character,
      transport,
      pty: session.preview,
      placement,
      readOnly: spec?.readOnly ?? false,
      visibility: spec?.visibility ?? 'both',
      broadcastGroups: new Set(spec?.broadcastGroups ?? []),
      createdAt: this.now(),
      lastActivityAt: this.now(),
      exitCode: session.exitCode,
      attentionLevel: session.attentionLevel,
      metadata,
      legacySessionId: session.id,
    };
    this.instances.set(id, instance);
    this.bySession.set(session.id, id);
    // Phase T7b — wrap the PTY write so every surface that still
    // writes via `inst.pty.write()` (legacy modal onKey, channel-bus
    // tail, future code) honors the readOnly flag. One monkey-patch
    // enforces the gate without touching PreviewTerminal,
    // InteractiveTerminalModal, or the session registry. Idempotent:
    // the `__matrixReadOnlyGuarded` marker prevents double-wrapping
    // if a session is somehow adopted twice.
    this.guardPtyWrites(instance);
    // NOTE: element-registry dual-write is deferred to Phase T2,
    // when a dedicated `terminal` ElementKind lands. Today the
    // existing `session:<legacyId>` address keeps working because
    // TerminalSessionRegistry publishes it on spawn.
    this.emit({ type: 'spawned', instance });
    return instance;
  }

  private guardPtyWrites(instance: TerminalInstance): void {
    const pty = instance.pty as unknown as {
      write: (bytes: string) => void;
      __matrixReadOnlyGuarded?: boolean;
    };
    if (pty.__matrixReadOnlyGuarded) return;
    const orig = pty.write.bind(pty);
    pty.write = (bytes: string) => {
      // Silent drop — the readOnly flag change fires its own event
      // when the flag flipped; surfaces don't need a per-keystroke
      // emission to react.
      if (instance.readOnly) return;
      orig(bytes);
    };
    pty.__matrixReadOnlyGuarded = true;
  }

  private updatePlacement(instance: TerminalInstance, placement: TerminalPlacement): void {
    if (placementEquals(instance.placement, placement)) return;
    const prev = instance.placement;
    instance.placement = placement;
    instance.lastActivityAt = this.now();
    this.emit({ type: 'placement', instance, prev });
  }

  private emit(ev: TerminalEvent): void {
    for (const cb of this.subscribers) {
      try { cb(ev); } catch { /* subscriber errors don't poison peers */ }
    }
  }

  private inferCharacter(session: TerminalSession): TerminalCharacter {
    if (session.kind === 'coding-agent') {
      return session.agentBrand === 'codex' ? { kind: 'codex' } : { kind: 'claude-code' };
    }
    return { kind: 'shell' };
  }

  private inferPlacement(session: TerminalSession): TerminalPlacement {
    if (session.state === 'foreground' && session.modal) {
      return { kind: 'modal', modalId: session.modal.id };
    }
    return { kind: 'background' };
  }

  private characterToLegacyKind(c: TerminalCharacter): 'shell' | 'coding-agent' {
    return c.kind === 'shell' || c.kind === 'custom' ? 'shell' : 'coding-agent';
  }

  private characterToAgentBrand(c: TerminalCharacter): 'claude-code' | 'codex' | undefined {
    if (c.kind === 'claude-code') return 'claude-code';
    if (c.kind === 'codex') return 'codex';
    return undefined;
  }
}

export function placementEquals(a: TerminalPlacement, b: TerminalPlacement): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'modal' && b.kind === 'modal') return a.modalId === b.modalId;
  if (a.kind === 'vw' && b.kind === 'vw') return a.windowId === b.windowId && a.slotId === b.slotId;
  return true;
}

/** Compose the `exec …` suffix for recharacterAndReexec. Returns
 *  null when no reexec is needed (e.g. plain shell without a
 *  specific shell path override). */
function buildReexecCommand(c: TerminalCharacter): string | null {
  switch (c.kind) {
    case 'claude-code':     return 'claude-code';
    case 'codex':           return 'codex';
    case 'custom': {
      const args = (c.spawnArgs ?? []).map(quoteForShell).join(' ');
      return args ? `${quoteForShell(c.name)} ${args}` : quoteForShell(c.name);
    }
    case 'shell':
      // Only reexec when the caller explicitly chose a different
      // shell binary; otherwise the PTY is already running it.
      return c.shell ? quoteForShell(c.shell) : null;
  }
}

function quoteForShell(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
