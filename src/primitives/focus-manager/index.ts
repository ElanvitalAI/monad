// ─────────────────────────────────────────────────────────────────
// FocusManager Primitive — Phase F-1 of PLAN-focus-manager-primitive.md
// · ROADMAP-interaction-fabric §5.2 #15
//
// This module owns focus state + focusable node registry + scope-
// filtered cycling + AppCUI-rs-style parent→child path construction.
// It does NOT own: paint, key dispatch, modal mount/dispose. Those
// remain in coordinator.ts / plugin-host. F-2 (coordinator attach)
// will wire `modalLifecycle.on('mounted')` into `focusManager.register`
// so modal push automatically brings focus. F-3 will migrate the 37
// `setFocus` call sites to this primitive.
//
// Why it exists
//   coordinator.ts mixes six responsibilities in 1,035 LOC. The focus
//   slice (~180 LOC) has 37 setFocus sites across 10 files. CAPABILITIES-
//   display §7.1 documents a recurring picker-flicker regression whose
//   structural cause is closeSurface's single-branch focus cleanup. By
//   extracting focus into a primitive we:
//     • Reduce coordinator LOC toward the <600 target (joint with
//       ModalLifecycle §5.2 #14 which landed B-1/B-2 as PR #266/#269).
//     • Give focus an explicit tree contract (AppCUI-rs parent chain)
//       so nested modal/picker semantics stay coherent.
//     • Expose focused/blurred/cycled/restored events so downstream
//       observers (routeInputEvent, state bridges, LLM tooling) can
//       react instead of polling.
//
// Design references (5-framework research in PLAN §2)
//   • AppCUI-rs `runtime_manager.rs:1042-1121` process_focus_change —
//     parent→child path built from Vec, then 역순 pop invokes on_focus
//     from root to leaf. Our `pathTo(id)` / `focusChain()` translates
//     this to TS. Generations from `handle_manager.rs:37-45` atomic
//     u32 counter — shared with ModalLifecycle via `nextGeneration()`
//     (Session B SYNC PR #282 §2.1) so cross-primitive handle diff
//     stays monotonic.
//   • Textual `Screen.focus_chain` — document-order traversal. Our
//     `cycle(scope, dir)` with `policy: 'order'` follows this.
//   • Flutter `FocusTraversalPolicy` — pluggable ordering strategy.
//     Our `FocusPolicy = 'order' | 'priority'` is a narrow 2-option
//     subset; default `'priority'` reproduces coordinator's current
//     behavior (higher-priority node wins tie-breaks).
//   • ModalLifecycle event subscription pattern (PR #266/#269) — modal
//     push/pop are observed, not polled. F-2 will subscribe to
//     'mounted' / 'disposed' and auto-register / unregister focus
//     nodes. F-1 exposes the plumbing; F-2 wires it.
//   • Implementation discipline (Session B SYNC PR #282 §2):
//       - generation counter shared with ModalLifecycle.
//       - `pathTo(id)` guards cycles (depth cap 64 + visited Set).
//       - listener throws isolated via try/catch per listener.
//       - `restorePrevious` is 1-level only — `previous` is a single
//         value, not a multi-level undo stack.
// ─────────────────────────────────────────────────────────────────

import type { SurfaceId, SurfaceOwner } from '../../display/types.js';
import { nextGeneration } from '../modal-lifecycle/index.js';
import { debug } from '../../debug/log.js';

// ─── Types ──────────────────────────────────────────────────────

/** A focus-capable zone that the primitive cycles through. Scopes
 *  are intentionally open — `SurfaceOwner` strings (e.g. `'dashboard'`,
 *  `'plugin:foo'`) are permitted so plugins can partition their own
 *  focus rings. The four convenience literals
 *  (`'modal'` / `'pane'` / `'widget'` / inherit from owner) cover the
 *  most common cases. */
export type FocusScope = SurfaceOwner | 'modal' | 'pane' | 'widget';

/** Public read-only reference to a focusable node. Callers build one
 *  of these to call `register`; the primitive keeps an internal
 *  augmented record (with `generation` for handle diffing, added per
 *  Session B SYNC §2.1). Public contract from PLAN §3 stays unchanged. */
export interface FocusNodeRef {
  readonly id: SurfaceId;
  readonly scope: FocusScope;
  readonly focusable: boolean;
  /** Higher = more recent / more important. Ordering policy uses
   *  this when `policy === 'priority'`. */
  readonly priority: number;
  readonly owner: SurfaceOwner;
  /** Parent id — enables AppCUI-rs-style path construction. `null`
   *  (or omitted) means "top level" (desktop / workspace root).
   *  Optional: if all nodes omit parent, focus degrades to a flat
   *  stack while `pathTo` returns just the node itself. */
  readonly parent?: SurfaceId | null;
}

/** Traversal policy for `cycle`. Default `'priority'` reproduces the
 *  current coordinator behavior (sort by priority desc, tiebreak by
 *  insertion order). `'order'` is Textual-style document order. */
export type FocusPolicy = 'order' | 'priority';

/** Snapshot of the manager's focus state. Returned by `state()`. */
export interface FocusState {
  /** The single currently-focused node, or null when nothing is
   *  focused. Matches coordinator's `focus.active`. */
  readonly active: SurfaceId | null;
  /** The node focused immediately before `active` — used by
   *  `restorePrevious()` after modal dismissal. Single value;
   *  multi-level undo is the caller's responsibility. */
  readonly previous: SurfaceId | null;
  /** Append-only history. Newest entry at the end. Pruned when
   *  nodes are unregistered. Mirrors coordinator's `focus.stack`
   *  semantically but with typed immutable view. */
  readonly history: readonly SurfaceId[];
}

/** Event kinds fired by the primitive. */
export type FocusEventKind =
  | 'focused'         // node became active
  | 'blurred'         // node was active, no longer
  | 'cycled'          // cycle() changed active within a scope
  | 'restored';       // restorePrevious() succeeded

/** Event payload. `node` = the newly-active node (or null on blur/
 *  clear); `prior` = the node that was active immediately before
 *  this event. `reason` is the caller-supplied string for
 *  debuggability (mirrors coordinator's setFocus(reason) convention). */
export interface FocusEvent {
  readonly kind: FocusEventKind;
  readonly node: FocusNodeRef | null;
  readonly prior: FocusNodeRef | null;
  readonly reason: string;
}

export type FocusListener = (ev: FocusEvent) => void;

// ─── Contract ───────────────────────────────────────────────────

export interface FocusManager {
  // Registration
  register(node: FocusNodeRef): () => void;
  unregister(id: SurfaceId): void;
  isRegistered(id: SurfaceId): boolean;

  // Query
  state(): FocusState;
  active(): FocusNodeRef | null;
  previous(): FocusNodeRef | null;
  focusableInScope(scope: FocusScope): readonly FocusNodeRef[];

  // Mutation
  setFocus(id: SurfaceId, reason: string): boolean;
  clear(reason: string): void;
  restorePrevious(reason: string): boolean;
  cycle(scope: FocusScope, dir: 1 | -1, reason: string): SurfaceId | null;
  /** Run a passive render while preserving the focus active immediately before
   * rendering unless a modal owns focus. Explicit user focus changes run outside
   * this boundary. */
  withPassiveRenderFocus<T>(render: () => T): T;

  // Tree operations · AppCUI-rs runtime_manager.rs:1042-1121 pattern
  pathTo(id: SurfaceId): readonly FocusNodeRef[];
  focusChain(): readonly FocusNodeRef[];

  // Observation
  on(kind: FocusEventKind, cb: FocusListener): () => void;

  readonly policy: FocusPolicy;
}

/** Depth cap for `pathTo`. TUI nesting (modal → popup → picker) is
 *  typically 2-3 levels; 64 is deep enough for any realistic chain
 *  and cheap to bound. Session B SYNC §2.2 recommended this cap
 *  together with the visited Set so bad input (A.parent=B,
 *  B.parent=A) cannot infinite-loop. */
export const PATH_DEPTH_CAP = 64;

// ─── Internal record ────────────────────────────────────────────

interface FocusNodeInternal extends FocusNodeRef {
  /** Monotonic handle generation — shared with ModalLifecycle via
   *  `nextGeneration()` (Session B SYNC §2.1). Tracked internally so
   *  observers that care about stale handle detection can read via
   *  future F-2/F-3 API; public `FocusNodeRef` contract unchanged. */
  readonly generation: number;
  /** Insertion index — used for `policy: 'order'` traversal and for
   *  stable tie-breaking under `policy: 'priority'`. */
  readonly insertionIndex: number;
}

// ─── Implementation ─────────────────────────────────────────────

class FocusManagerImpl implements FocusManager {
  private readonly nodes = new Map<SurfaceId, FocusNodeInternal>();
  private readonly listeners = new Map<FocusEventKind, Set<FocusListener>>();
  private focusState: FocusState = { active: null, previous: null, history: [] };
  private nextInsertionIndex = 0;

  constructor(
    readonly policy: FocusPolicy,
    private readonly passiveRenderFocus = false,
  ) {}

  // ── Registration ──

  register(node: FocusNodeRef): () => void {
    if (this.nodes.has(node.id)) {
      throw new Error(
        `FocusManager: node '${node.id}' already registered. `
        + `Call the returned disposer (or unregister) before re-registering.`,
      );
    }
    const internal: FocusNodeInternal = {
      ...node,
      // Normalize parent to null — callers may pass undefined.
      parent: node.parent ?? null,
      generation: nextGeneration(),
      insertionIndex: this.nextInsertionIndex++,
    };
    this.nodes.set(node.id, internal);
    if (debug.enabled) {
      debug.log('focus-manager.register', node.id, {
        scope: node.scope, priority: node.priority, focusable: node.focusable,
        generation: internal.generation,
      });
    }
    return () => {
      // Idempotent: drop only if current entry is the same we inserted.
      if (this.nodes.get(node.id) === internal) {
        this.unregister(node.id);
      }
    };
  }

  unregister(id: SurfaceId): void {
    if (!this.nodes.has(id)) return;
    this.nodes.delete(id);
    // Prune state if the unregistered node was active/previous/in history.
    const { active, previous, history } = this.focusState;
    const nextActive = active === id ? null : active;
    const nextPrevious = previous === id ? null : previous;
    const nextHistory = history.filter((h) => h !== id);
    if (
      nextActive !== active
      || nextPrevious !== previous
      || nextHistory.length !== history.length
    ) {
      this.focusState = {
        active: nextActive,
        previous: nextPrevious,
        history: nextHistory,
      };
    }
    if (debug.enabled) debug.log('focus-manager.unregister', id, {});
  }

  isRegistered(id: SurfaceId): boolean {
    return this.nodes.has(id);
  }

  // ── Query ──

  state(): FocusState {
    return this.focusState;
  }

  active(): FocusNodeRef | null {
    const id = this.focusState.active;
    return id !== null ? (this.nodes.get(id) ?? null) : null;
  }

  previous(): FocusNodeRef | null {
    const id = this.focusState.previous;
    return id !== null ? (this.nodes.get(id) ?? null) : null;
  }

  focusableInScope(scope: FocusScope): readonly FocusNodeRef[] {
    const out: FocusNodeInternal[] = [];
    for (const node of this.nodes.values()) {
      if (node.scope === scope && node.focusable) out.push(node);
    }
    return this.sortByPolicy(out);
  }

  // ── Mutation ──

  setFocus(id: SurfaceId, reason: string): boolean {
    const node = this.nodes.get(id);
    if (!node) {
      if (debug.enabled) debug.log('focus-manager.setFocus.unknown', id, { reason });
      return false;
    }
    if (!node.focusable) {
      if (debug.enabled) debug.log('focus-manager.setFocus.non-focusable', id, { reason });
      return false;
    }
    if (this.focusState.active === id) {
      // Idempotent no-op — active already matches.
      return true;
    }

    const priorId = this.focusState.active;
    const priorNode = priorId !== null ? (this.nodes.get(priorId) ?? null) : null;
    // Build new history — dedupe consecutive entry of same id.
    const historyBase = this.focusState.history;
    const nextHistory = historyBase.length > 0 && historyBase[historyBase.length - 1] === id
      ? historyBase
      : [...historyBase, id];
    this.focusState = {
      active: id,
      previous: priorId,
      history: nextHistory,
    };
    if (debug.enabled) {
      debug.log('focus-manager.setFocus', id, {
        reason, priorId, historyLength: nextHistory.length,
      });
    }
    if (priorNode !== null) {
      this.emit({ kind: 'blurred', node: priorNode, prior: priorNode, reason });
    }
    this.emit({ kind: 'focused', node, prior: priorNode, reason });
    return true;
  }

  withPassiveRenderFocus<T>(render: () => T): T {
    // ⚠️ 복원 대상은 **렌더 직전 포커스**다 — 고정 id 가 아니다(리뷰 must-fix).
    //   고정 id 로 밀면 사용자가 `wd-log` 로 명시 전환한 뒤 **다음 스트림 렌더가 도로 뺏어온다**.
    //   passiveRenderFocus 는 "이 매니저가 수동 렌더를 보호한다" 는 opt-in 스위치일 뿐이다.
    const before = this.focusState.active;
    try {
      return render();
    } finally {
      this.restoreFocusAfterPassiveRender(before);
    }
  }

  clear(reason: string): void {
    const priorId = this.focusState.active;
    if (priorId === null) return;
    const priorNode = this.nodes.get(priorId) ?? null;
    this.focusState = {
      active: null,
      previous: priorId,
      history: this.focusState.history,
    };
    if (debug.enabled) debug.log('focus-manager.clear', priorId, { reason });
    if (priorNode !== null) {
      this.emit({ kind: 'blurred', node: priorNode, prior: priorNode, reason });
    }
  }

  restorePrevious(reason: string): boolean {
    const prevId = this.focusState.previous;
    if (prevId === null) return false;
    const prevNode = this.nodes.get(prevId);
    if (!prevNode || !prevNode.focusable) {
      // Stale previous — unregistered or no longer focusable.
      if (debug.enabled) {
        debug.log('focus-manager.restorePrevious.stale', prevId, { reason });
      }
      return false;
    }
    const activeId = this.focusState.active;
    const activeNode = activeId !== null ? (this.nodes.get(activeId) ?? null) : null;
    // Swap active ↔ previous. This is intentionally 1-level deep —
    // calling restorePrevious again swaps back. Multi-level undo is
    // the caller's responsibility (history is an append-only view,
    // not an undo stack). Session B SYNC §2.4 pins this behavior.
    this.focusState = {
      active: prevId,
      previous: activeId,
      history: this.focusState.history,
    };
    if (debug.enabled) {
      debug.log('focus-manager.restorePrevious', prevId, { reason, swappedFrom: activeId });
    }
    if (activeNode !== null) {
      this.emit({ kind: 'blurred', node: activeNode, prior: activeNode, reason });
    }
    this.emit({ kind: 'restored', node: prevNode, prior: activeNode, reason });
    return true;
  }

  cycle(scope: FocusScope, dir: 1 | -1, reason: string): SurfaceId | null {
    const pool = this.focusableInScope(scope);
    if (pool.length === 0) return null;
    const activeId = this.focusState.active;
    const activeIdx = activeId !== null
      ? pool.findIndex((n) => n.id === activeId)
      : -1;
    // If the current active is outside the pool, start from the first
    // node in the direction of travel.
    let nextIdx: number;
    if (activeIdx < 0) {
      nextIdx = dir === 1 ? 0 : pool.length - 1;
    } else {
      // Wrap-around via modulo; guard against negative modulo with +length.
      nextIdx = (activeIdx + dir + pool.length) % pool.length;
    }
    const nextNode = pool[nextIdx]!;
    if (nextNode.id === activeId) {
      // Single-element pool or no change — still report as cycled for
      // symmetry; the listener can inspect prior vs node to detect
      // no-op. We choose NOT to emit to avoid subscriber spam.
      return nextNode.id;
    }
    const priorNode = activeId !== null ? (this.nodes.get(activeId) ?? null) : null;
    this.focusState = {
      active: nextNode.id,
      previous: activeId,
      history: this.focusState.history.length > 0
        && this.focusState.history[this.focusState.history.length - 1] === nextNode.id
        ? this.focusState.history
        : [...this.focusState.history, nextNode.id],
    };
    if (debug.enabled) {
      debug.log('focus-manager.cycle', nextNode.id, {
        scope, dir, reason, poolSize: pool.length, activeIdx, nextIdx,
      });
    }
    this.emit({ kind: 'cycled', node: nextNode, prior: priorNode, reason });
    return nextNode.id;
  }

  // ── Tree ops ──

  pathTo(id: SurfaceId): readonly FocusNodeRef[] {
    const path: FocusNodeInternal[] = [];
    const visited = new Set<SurfaceId>();
    let cur: SurfaceId | null = id;
    while (
      cur !== null
      && !visited.has(cur)
      && path.length < PATH_DEPTH_CAP
    ) {
      visited.add(cur);
      const node = this.nodes.get(cur);
      if (!node) break;
      path.push(node);
      cur = node.parent ?? null;
    }
    if (path.length >= PATH_DEPTH_CAP && cur !== null && !visited.has(cur)) {
      // Truncated at cap — warn so deep chains can be investigated.
      // Session B SYNC §2.2: depth cap 64.
      if (debug.enabled) {
        debug.log('focus-manager.pathTo.truncated', id, {
          cap: PATH_DEPTH_CAP, reachedAncestor: cur,
        });
      }
    }
    path.reverse();  // root → leaf order per AppCUI-rs pattern
    return path;
  }

  focusChain(): readonly FocusNodeRef[] {
    const activeId = this.focusState.active;
    if (activeId === null) return [];
    return this.pathTo(activeId);
  }

  // ── Observation ──

  on(kind: FocusEventKind, cb: FocusListener): () => void {
    let set = this.listeners.get(kind);
    if (!set) {
      set = new Set();
      this.listeners.set(kind, set);
    }
    set.add(cb);
    return () => {
      const s = this.listeners.get(kind);
      if (s) s.delete(cb);
    };
  }

  // ── Internals ──

  /** 수동 렌더가 **부수적으로** 옮긴 포커스만 되돌린다.
   *
   *  - opt-in(`passiveRenderFocus`) 이 없으면 아무것도 안 한다(무회귀).
   *  - 렌더 중 **모달이 포커스를 가져갔으면 그대로 둔다**(모달 우선권).
   *  - 렌더 전 포커스가 사라졌거나(unregister) 애초에 없었으면 손대지 않는다.
   *  ⇒ 사용자가 렌더 전에 어디에 있었든 **그 자리로** 돌아온다. */
  private restoreFocusAfterPassiveRender(before: SurfaceId | null): void {
    if (!this.passiveRenderFocus) return;
    if (before === null) return;
    const active = this.active();
    if (active?.id === before) return;                 // 안 옮겨졌다
    if (active?.scope === 'modal') return;             // 모달이 이겼다 — 존중
    if (!this.isRegistered(before)) return;            // 렌더가 그 노드를 없앴다
    if (debug.enabled) {
      debug.log('focus-manager.passive-render.restore', before, {
        movedTo: active?.id ?? null,
      });
    }
    this.setFocus(before, 'passive-render:restore-previous');
  }

  private emit(ev: FocusEvent): void {
    const set = this.listeners.get(ev.kind);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(ev);
      } catch {
        // Swallow: a buggy listener must not break the emit chain or
        // the primitive's own state machine. Session B SYNC §2.3 —
        // same discipline as ModalLifecycle B-1.
      }
    }
  }

  private sortByPolicy(nodes: readonly FocusNodeInternal[]): FocusNodeInternal[] {
    const copy = nodes.slice();
    if (this.policy === 'order') {
      copy.sort((a, b) => a.insertionIndex - b.insertionIndex);
    } else {
      // priority: descending priority, then ascending insertion (stable tiebreak)
      copy.sort((a, b) => {
        if (a.priority !== b.priority) return b.priority - a.priority;
        return a.insertionIndex - b.insertionIndex;
      });
    }
    return copy;
  }
}

/** Build a fresh FocusManager. Pass `policy` to select traversal
 *  strategy; defaults to `'priority'` to match current coordinator
 *  behavior so F-2 coordinator attach is a drop-in. */
export function createFocusManager(opts?: {
  policy?: FocusPolicy;
  /** Preserve the focus active immediately before passive renders. */
  passiveRenderFocus?: boolean;
}): FocusManager {
  const policy: FocusPolicy = opts?.policy ?? 'priority';
  return new FocusManagerImpl(policy, opts?.passiveRenderFocus);
}
