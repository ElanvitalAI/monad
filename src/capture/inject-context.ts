// H6 P7 · Inject capture to context · Tier B.
//
// Atomic pipeline: P6 registry.snapshot(sourceId) → wrap per `as`
// mode → HITL binary approver (requestConfirmation) → target.send()
// → 'inject' edge + control-audit-log entry. Complements P5
// AgentReply (message-only bi-directional) by shipping structured
// *snapshot blocks* in one approved action.
//
// Design rails (PLAN §5 D1-D11):
//   - D1  Binary approver via `requestConfirmation` (not AskUserQuestion)
//   - D2  Three `as` modes · pure text transforms · no agent coupling
//   - D3  Source via `registry.snapshot(sourceId, {at})` direct call
//   - D4  Target via `findLiveSessionById` · PTY-only (v1)
//   - D5  Edge kind 'inject' · NO cycle cap (user-explicit action)
//   - D6  Audit `action: 'capture_inject'` · ok=false for denied/error
//   - D7  Non-revocable v1 · send() flushes to PTY buffer
//   - D8  Warn-only redact · provider warnings propagate to preview
//   - D10 Error taxonomy · user-denied is NOT isError (informational)
//   - D12 Preview cap 500 chars in HITL detail

import { debug } from '../debug/log.js';
import {
  defaultAgentGraph,
  type AgentGraph,
  type AgentGraphEdge,
} from '../agent/agent-graph.js';
import type { EmbodiedAgentSession } from '../agent/embodiment.js';
import {
  defaultCaptureSourceRegistry,
  type CaptureSourceRegistry,
} from './source-registry.js';
import type { SnapshotResult } from './providers/types.js';
import {
  requestConfirmation,
  type ConfirmOpts,
  type ConfirmResult,
  type HitlChannelName,
} from '../hitl/confirm.js';
import {
  recordControlAudit,
  type ControlAuditEvent,
} from '../control-audit-log.js';
import { defaultControlSignalBus, type ControlSignalBus } from '../input/control-signal.js';
import { findRecentQuickPassSignal } from '../input/turn-submit-revision.js';

export const INJECT_USER_GHOST_SESSION_ID = 'user';
const PREVIEW_CAP = 500;

/** D4 (Bundle 2 · 2026-04-28) — transports the inject pipeline can
 *  route through. `pty` was the v1-only target; `acp` was added when
 *  showroom v2 needed to handoff into ACP-backed sessions
 *  (elanous-as-child). Adding a new transport kind here is the single
 *  switch that opens the inject pipeline to it — `target.send()` is
 *  already transport-agnostic. */
type InjectableTransportKind = 'pty' | 'acp';
const SUPPORTED_INJECT_TRANSPORTS: readonly InjectableTransportKind[] = [
  'pty', 'acp',
];

export type InjectMode = 'user-message' | 'system-note' | 'attached-block';

const VALID_MODES: readonly InjectMode[] = [
  'user-message', 'system-note', 'attached-block',
];

export interface InjectOpts {
  readonly sourceId: string;
  readonly targetSessionId: string;
  readonly as: InjectMode;
  readonly at?: number;
  readonly fromSessionId?: string;
  /** Test seam · production callers MUST leave this unset so the HITL
   *  approver always runs. */
  readonly skipApprover?: boolean;
}

export interface InjectResult {
  readonly sourceId: string;
  readonly targetSessionId: string;
  readonly as: InjectMode;
  readonly injectedBytes: number;
  readonly warnings: readonly string[];
  readonly approvedVia: HitlChannelName | 'timeout' | 'all-failed' | 'bypassed';
  readonly elapsedMs: number;
  readonly capturedAt: number;
  /** Set when inject succeeded (approver yes + send ok). */
  readonly edge?: AgentGraphEdge;
  /** Set when approver said no / timed out — informational, not an error. */
  readonly denied?: true;
}

export type InjectErrorCode =
  | 'source-missing'
  | 'target-missing'
  | 'target-dead'
  | 'invalid-mode'
  | 'preempted'
  | 'send-failed';

export class InjectError extends Error {
  constructor(
    readonly code: InjectErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'InjectError';
  }
}

export interface InjectTargetEntry {
  readonly session: EmbodiedAgentSession;
}

export interface InjectDeps {
  readonly registry?: Pick<CaptureSourceRegistry, 'snapshot'>;
  readonly lookupSession: (id: string) => InjectTargetEntry | undefined;
  readonly approver?: (req: ConfirmOpts) => Promise<ConfirmResult>;
  readonly graph?: AgentGraph;
  readonly audit?: (ev: ControlAuditEvent) => void;
  readonly signalBus?: ControlSignalBus;
  readonly now?: () => number;
}

export async function injectCapture(
  opts: InjectOpts,
  deps: InjectDeps,
): Promise<InjectResult> {
  // D11 pre-validate mode so callers get a clean error before any
  // snapshot / session work.
  if (!VALID_MODES.includes(opts.as)) {
    throw new InjectError(
      'invalid-mode',
      `injectCapture · invalid as='${opts.as}' · must be one of ${VALID_MODES.join(', ')}`,
    );
  }
  if (!opts.sourceId || typeof opts.sourceId !== 'string') {
    throw new InjectError('source-missing', 'injectCapture · sourceId required');
  }
  if (!opts.targetSessionId || typeof opts.targetSessionId !== 'string') {
    throw new InjectError('target-missing', 'injectCapture · targetSessionId required');
  }

  const registry = deps.registry ?? defaultCaptureSourceRegistry();
  const graph = deps.graph ?? defaultAgentGraph;
  const now = deps.now ?? Date.now;
  const approver = deps.approver ?? requestConfirmation;
  const audit = deps.audit ?? recordControlAudit;
  const signalBus = deps.signalBus ?? defaultControlSignalBus();

  const startedAt = now();
  const fromId = opts.fromSessionId ?? INJECT_USER_GHOST_SESSION_ID;

  // D4 · target resolution. PTY-only in v1 (mirrors P5 D3).
  const targetEntry = deps.lookupSession(opts.targetSessionId);
  if (!targetEntry) {
    recordFailure(audit, opts, 'target-missing', now() - startedAt);
    throw new InjectError(
      'target-missing',
      `injectCapture · target session '${opts.targetSessionId}' not found`,
    );
  }
  const target = targetEntry.session;
  const status = target.state().status;
  if (status === 'done' || status === 'error') {
    recordFailure(audit, opts, 'target-dead', now() - startedAt);
    throw new InjectError(
      'target-dead',
      `injectCapture · target '${opts.targetSessionId}' is ${status}`,
    );
  }
  // D4 (Bundle 2 · 2026-04-28) — accept both PTY and ACP transports.
  // `target.send()` is transport-agnostic: PTY adapters write to the
  // pty stream, elanous-as-child (ACP) writes to `child.stdin` which the
  // sub-elanous parses as JSON-RPC. The HITL approver and audit pipeline
  // are unchanged — only the precondition check widens.
  // See: 내부 문서 `PLAN-showroom-v2-lane-handoff-2026-04-28` §D6.
  const hasInjectableTransport = target.transports.some(
    (t) => SUPPORTED_INJECT_TRANSPORTS.includes(t.kind as InjectableTransportKind),
  );
  if (!hasInjectableTransport) {
    const seen = target.transports.map((t) => t.kind).join(', ') || '(none)';
    recordFailure(audit, opts, 'target-dead', now() - startedAt, 'unsupported-transport');
    throw new InjectError(
      'target-dead',
      `injectCapture · target '${opts.targetSessionId}' has no injectable transport · ` +
      `requires one of [${SUPPORTED_INJECT_TRANSPORTS.join(', ')}] · got [${seen}]`,
    );
  }

  const preempt = findRecentQuickPassSignal({
    signalBus,
    scope: { sessionId: opts.targetSessionId },
    signalKinds: ['capture-inject-stop'],
  });
  if (preempt) {
    recordFailure(audit, opts, 'preempted', now() - startedAt, preempt.kind);
    throw new InjectError(
      'preempted',
      `injectCapture · preempted by recent ${preempt.kind} quick-pass signal`,
    );
  }

  // D3 · snapshot directly via registry.snapshot(). UnknownCaptureSourceError
  // surfaces as InjectError('source-missing').
  let snap: SnapshotResult;
  try {
    snap = await registry.snapshot(opts.sourceId, opts.at !== undefined ? { at: opts.at } : {});
  } catch (err) {
    recordFailure(audit, opts, 'source-missing', now() - startedAt,
      err instanceof Error ? err.message : String(err));
    throw new InjectError(
      'source-missing',
      `injectCapture · snapshot failed for '${opts.sourceId}': ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // D2 · wrap body per mode BEFORE approver so preview reflects what
  // will actually be sent (minus the 500-char cap).
  const wrapped = wrapBody(snap, opts.as);

  // D1 · HITL binary approver. Test seam `skipApprover` bypasses for
  // unit tests; prod callers leave it unset.
  let approval: ConfirmResult;
  if (opts.skipApprover) {
    approval = { answer: true, channel: 'bypassed' as HitlChannelName, elapsedMs: 0 };
  } else {
    approval = await approver(buildApprovalRequest(snap, opts.as, {
      id: opts.targetSessionId,
      brand: target.launchSpec.brand,
      label: target.transports[0]?.label ?? target.launchSpec.brand,
    }));
  }

  if (!approval.answer) {
    const elapsedMs = now() - startedAt;
    const denyWarnings = [
      ...snap.warnings,
      approval.channel === 'timeout' ? 'approver-timeout' : 'approver-denied',
    ];
    audit({
      ts: new Date(now()).toISOString(),
      action: 'capture_inject',
      subject: opts.targetSessionId,
      ok: false,
      detail: {
        sourceId: opts.sourceId,
        as: opts.as,
        rejectionReason: approval.channel === 'timeout' ? 'approver-timeout' : 'user-denied',
        approvedVia: approval.channel,
        elapsedMs,
      },
    });
    if (debug.enabled) {
      debug.log('capture.inject.denied', opts.sourceId, {
        target: opts.targetSessionId,
        channel: approval.channel,
      });
    }
    return {
      sourceId: opts.sourceId,
      targetSessionId: opts.targetSessionId,
      as: opts.as,
      injectedBytes: 0,
      warnings: denyWarnings,
      approvedVia: approval.channel,
      elapsedMs,
      capturedAt: snap.capturedAt,
      denied: true,
    };
  }

  // D7 · send() is the non-revocable commit point. After this returns,
  // the bytes are in the PTY buffer — no undo.
  try {
    await target.send(wrapped);
  } catch (err) {
    const elapsedMs = now() - startedAt;
    audit({
      ts: new Date(now()).toISOString(),
      action: 'capture_inject',
      subject: opts.targetSessionId,
      ok: false,
      detail: {
        sourceId: opts.sourceId,
        as: opts.as,
        rejectionReason: 'send-failed',
        errorMessage: err instanceof Error ? err.message : String(err),
        approvedVia: approval.channel,
        elapsedMs,
      },
    });
    throw new InjectError(
      'send-failed',
      `injectCapture · target.send failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // D5 · record 'inject' edge with metadata.
  const edgeMeta: Record<string, unknown> = {
    sourceId: opts.sourceId,
    sourceType: parseSourceType(opts.sourceId),
    as: opts.as,
    bytes: wrapped.length,
    capturedAt: snap.capturedAt,
    approvedVia: approval.channel,
  };
  if (snap.sourceRef) edgeMeta.sourceRef = snap.sourceRef;
  if (snap.warnings.length > 0) edgeMeta.warnings = [...snap.warnings];
  const edge = graph.recordEdge({
    from: fromId,
    to: opts.targetSessionId,
    kind: 'inject',
    meta: edgeMeta,
  });

  const elapsedMs = now() - startedAt;
  audit({
    ts: new Date(now()).toISOString(),
    action: 'capture_inject',
    subject: opts.targetSessionId,
    ok: true,
    detail: {
      sourceId: opts.sourceId,
      sourceType: parseSourceType(opts.sourceId),
      as: opts.as,
      bytes: wrapped.length,
      approvedVia: approval.channel,
      ...(snap.sourceRef ? { sourceRef: snap.sourceRef } : {}),
      warnings: [...snap.warnings],
      elapsedMs,
      capturedAt: snap.capturedAt,
    },
  });

  if (debug.enabled) {
    debug.log('capture.inject.ok', opts.sourceId, {
      target: opts.targetSessionId,
      as: opts.as,
      bytes: wrapped.length,
      approvedVia: approval.channel,
    });
  }

  return {
    sourceId: opts.sourceId,
    targetSessionId: opts.targetSessionId,
    as: opts.as,
    injectedBytes: wrapped.length,
    warnings: [...snap.warnings],
    approvedVia: approval.channel,
    elapsedMs,
    capturedAt: snap.capturedAt,
    edge,
  };
}

// ─── Wrapping per `as` mode ─────────────────────────────────────────

export function wrapBody(snap: SnapshotResult, mode: InjectMode): string {
  const capturedIso = new Date(snap.capturedAt).toISOString();
  const label = snap.sourceSummary ?? snap.sourceId;

  // PNG source · carry base64 as a fenced block since raw bytes would
  // corrupt PTY streams.
  const bodyContent = snap.bodyBase64
    ? `\`\`\`base64\n${snap.bodyBase64}\n\`\`\``
    : snap.body;

  switch (mode) {
    case 'user-message':
      return bodyContent + (bodyContent.endsWith('\n') ? '' : '\n');
    case 'system-note':
      return [
        `[Context from monad-agent · source=${label}]`,
        bodyContent,
        `[/Context]`,
        '',
      ].join('\n');
    case 'attached-block': {
      const dimsAttr = snap.bodyBase64
        ? ` dims="${snap.dims.cols}x${snap.dims.rows}"`
        : '';
      return [
        `<context source="${snap.sourceId}" label="${escapeAttr(label)}" capturedAt="${capturedIso}"${dimsAttr}>`,
        bodyContent,
        `</context>`,
        '',
      ].join('\n');
    }
  }
}

function escapeAttr(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

// ─── HITL request composition ───────────────────────────────────────

export function buildApprovalRequest(
  snap: SnapshotResult,
  mode: InjectMode,
  target: { id: string; brand: string; label: string },
): ConfirmOpts {
  const preview = snap.body.length > PREVIEW_CAP
    ? snap.body.slice(0, PREVIEW_CAP) + `\n… (${snap.body.length - PREVIEW_CAP} more chars)`
    : snap.body;
  const previewBlock = snap.bodyBase64
    ? `[PNG · ${snap.bytes}B · ${snap.dims.cols}x${snap.dims.rows}]`
    : preview;
  const warnPrefix = snap.warnings.length > 0
    ? `⚠️  warnings: ${snap.warnings.join(', ')}\n\n`
    : '';
  return {
    prompt: `Inject ${snap.sourceSummary ?? snap.sourceId} into ${target.brand}[${target.id}]?`,
    detail: [
      `${warnPrefix}mode: ${mode}`,
      `bytes: ${snap.bytes}`,
      `captured: ${new Date(snap.capturedAt).toISOString()}`,
      '',
      `─── Preview (first ${PREVIEW_CAP} chars) ───`,
      previewBlock,
    ].join('\n'),
    yesLabel: 'Inject',
    noLabel: 'Deny',
    requestId: `inject-${Date.now()}`,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

function parseSourceType(id: string): string {
  const idx = id.indexOf(':');
  return idx > 0 ? id.slice(0, idx) : 'unknown';
}

function recordFailure(
  audit: (ev: ControlAuditEvent) => void,
  opts: InjectOpts,
  rejectionReason: string,
  elapsedMs: number,
  errorMessage?: string,
): void {
  audit({
    ts: new Date().toISOString(),
    action: 'capture_inject',
    subject: opts.targetSessionId,
    ok: false,
    detail: {
      sourceId: opts.sourceId,
      as: opts.as,
      rejectionReason,
      elapsedMs,
      ...(errorMessage ? { errorMessage } : {}),
    },
  });
}
