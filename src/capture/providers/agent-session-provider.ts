// H6 P6 · Agent session provider.
//
// Enumerates every live `EmbodiedAgentSession` and produces a text /
// ansi snapshot for each. Where an H5 P2 `TransportObserver` is
// attached (H6 P5 added the external lookup surface), the snapshot
// uses the observer's per-channel accumulators — much more useful
// to the LLM than a raw PTY screen. When no observer is present
// (legacy session · bootstrap race · paranoid opt-out) we fall back
// to `session.snapshot()` and emit an `'observer-missing'` warning.
//
// Id format: `agent-session:<session-id>`. The session id is already
// registry-minted (`emb-codex-pty-<seq>`) · no colons · safe to
// passthrough.
//
// Design rails (PLAN §D4):
//   - Observer present → channel-aware snapshot (text/ansi via
//     `formatChannels`).
//   - Observer absent  → raw `session.snapshot()` fallback + warning.
//   - PTY-less session (monad-as-child ACP-only) → rejected with
//     clear message (matches `AgentReply` behaviour).

import { buildSourceId } from '../source-registry.js';
import type {
  CaptureSourceDescriptor,
  CaptureSourceProvider,
  SnapshotOpts,
  SnapshotResult,
} from './types.js';
import type { CaptureFormat } from '../types.js';
import type { EmbodiedAgentSession } from '../../agent/embodiment.js';
import type { TransportObserver } from '../../agent/transport-observer.js';
import { buildTerminalObservationInputSourceRef } from '../../input/input-source-kind.js';

export interface AgentSessionListEntry {
  readonly session: EmbodiedAgentSession;
  readonly paneId?: string;
  readonly windowId?: number;
}

export interface AgentSessionProviderDeps {
  /** Snapshot of currently tracked live sessions. Prod path wraps
   *  `listLiveEmbodiedSessions()` · tests supply stubs. */
  readonly listSessions: () => readonly AgentSessionListEntry[];
  /** Optional · locate the TransportObserver attached to a session
   *  (H6 P5 `observer-registry`). Absent = raw snapshot fallback. */
  readonly findObserver?: (sessionId: string) => TransportObserver | undefined;
}

const TEXT_FORMATS: readonly CaptureFormat[] = ['text', 'ansi'];

export function createAgentSessionProvider(deps: AgentSessionProviderDeps): CaptureSourceProvider {
  return {
    type: 'agent-session',
    list() {
      const entries = deps.listSessions();
      const out: CaptureSourceDescriptor[] = [];
      for (const { session, paneId, windowId } of entries) {
        const observer = deps.findObserver?.(session.id);
        const channels = observer ? Object.keys(observer.snapshotChannels()) : [];
        const state = (() => { try { return session.state(); } catch { return { status: 'pending' as const }; } })();
        const summary = channels.length > 0
          ? `${state.status} · channels: ${channels.join(', ')}`
          : `${state.status} · (no observer)`;
        out.push({
          id: buildSourceId('agent-session', session.id),
          type: 'agent-session',
          label: `agent-session ${session.id} · ${session.launchSpec.brand}`,
          summary,
          formats: TEXT_FORMATS,
          sourceRef: buildTerminalObservationInputSourceRef({
            provider: 'pty',
            sessionId: session.id,
            capabilities: ['observe', 'verify'],
          }),
          ...(state.startedAt !== undefined ? { updatedAt: state.startedAt } : {}),
          meta: {
            brand: session.launchSpec.brand,
            ...(paneId !== undefined ? { paneId } : {}),
            ...(windowId !== undefined ? { windowId } : {}),
            observer: channels.length > 0,
          },
        });
      }
      return out;
    },
    async snapshot(id, opts): Promise<SnapshotResult> {
      const sessionId = parseAgentSessionId(id);
      const entry = deps.listSessions().find((e) => e.session.id === sessionId);
      if (!entry) {
        throw new Error(`agent-session provider: session '${sessionId}' not found`);
      }
      const hasPty = entry.session.transports.some((t) => t.kind === 'pty');
      if (!hasPty) {
        throw new Error(
          `agent-session provider: '${sessionId}' has no PTY transport · snapshot requires pty-backed session`,
        );
      }
      const format: CaptureFormat = opts.format ?? 'text';
      if (format !== 'text' && format !== 'ansi') {
        throw new Error(
          `agent-session provider: unsupported format '${format}' · only text/ansi in v1 (PNG via vw-pane provider when pane mapped)`,
        );
      }
      const warnings: string[] = [];
      if (opts.at !== undefined) warnings.push('historical-not-supported');
      const capturedAt = Date.now();
      const observer = deps.findObserver?.(sessionId);
      let body = '';
      if (observer) {
        body = formatChannels(observer.snapshotChannels());
      } else {
        warnings.push('observer-missing');
        try {
          body = await entry.session.snapshot();
        } catch (err) {
          warnings.push(`snapshot-failed:${err instanceof Error ? err.message : String(err)}`);
          body = '';
        }
      }
      if (body.length === 0) warnings.push('source-empty');
      const dims = opts.dims ?? { cols: 80, rows: 24 };
      return {
        sourceId: id,
        format,
        body,
        bytes: Buffer.byteLength(body, 'utf8'),
        dims,
        capturedAt,
        sourceRef: buildTerminalObservationInputSourceRef({
          provider: 'pty',
          sessionId,
          capabilities: ['observe', 'verify'],
        }),
        warnings,
      };
    },
  };
}

/** Pretty-print the per-channel map used when an observer is present.
 *  Each channel becomes a `[name]` header followed by the trimmed body.
 *  Single-channel case collapses to the body alone. */
export function formatChannels(channels: Readonly<Record<string, string>>): string {
  const entries = Object.entries(channels).filter(([, v]) => typeof v === 'string' && v.length > 0);
  if (entries.length === 0) return '';
  if (entries.length === 1) return entries[0]![1].trim();
  return entries.map(([k, v]) => `[${k}]\n${v.trim()}`).join('\n\n');
}

export function parseAgentSessionId(id: string): string {
  const prefix = 'agent-session:';
  if (!id.startsWith(prefix)) {
    throw new Error(`agent-session provider: expected id to start with '${prefix}' · got '${id}'`);
  }
  return id.slice(prefix.length);
}
