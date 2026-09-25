// WT-S-1 — `monad/term/*` envelope codec, mirror of daemon-side
// `src/acp/monad-extensions.ts`. Two copies because PWA is a separate
// build target with no path bridge into `../../src/acp`. Keep the wire
// shape identical or both ends will silently desync.
//
// Sentinel format (must match daemon-side):
//   [monad/term/<method>] <terminalId>
//   <json-payload>
//   <<monad-term-end <terminalId>>>

export type MonadTermMethod = 'terminalOutput' | 'terminalExit' | 'terminalInputActivity' | 'terminalFrame';

export interface MonadTermOutputPayload {
  terminalId: string;
  data: string;
}

export interface MonadTermExitPayload {
  terminalId: string;
  code: number;
}

/** ⭐P2 (capture substrate) — a full-screen RENDERED frame snapshot of a
 *  surface (e.g. the interactive dashboard TUI `tui:<pid>`), NOT an
 *  incremental stream. The PWA live-mirrors it by REPLACING the screen
 *  each frame (read-only monitoring). Mirror of daemon-side
 *  `MonadTermFramePayload`. cf. PLAN-self-observation-capture-substrate. */
export interface MonadTermFramePayload {
  terminalId: string;
  frame: string;
  instance: string;
  at: number;
}

/** WT-M-1 — ping emitted by daemon when a peer sends `terminal/input`.
 *  Other peers attached to the same terminal use this to show a brief
 *  "another device typed" indicator. The originating peer filters by
 *  its own `peerId` to skip self-echo. */
export interface MonadTermInputActivityPayload {
  terminalId: string;
  peerId: string;
  timestamp: number;
  bytes: number;
}

export type MonadTermEnvelope =
  | { method: 'terminalOutput'; payload: MonadTermOutputPayload }
  | { method: 'terminalExit'; payload: MonadTermExitPayload }
  | { method: 'terminalInputActivity'; payload: MonadTermInputActivityPayload }
  | { method: 'terminalFrame'; payload: MonadTermFramePayload };

export function parseMonadTermEnvelope(text: string): MonadTermEnvelope | null {
  const lines = text.split('\n');
  const first = lines[0];
  if (!first) return null;
  const m = /^\[monad\/term\/([a-zA-Z]+)\] (.+)$/.exec(first);
  if (!m) return null;
  const method = m[1];
  if (method !== 'terminalOutput' && method !== 'terminalExit' && method !== 'terminalInputActivity' && method !== 'terminalFrame') {
    return null;
  }
  const bodyLines: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^<<monad-term-end /.test(line)) break;
    bodyLines.push(line);
  }
  try {
    const payload = JSON.parse(bodyLines.join('\n')) as Record<string, unknown>;
    if (typeof payload.terminalId !== 'string') return null;
    if (method === 'terminalOutput') {
      if (typeof payload.data !== 'string') return null;
      return {
        method,
        payload: { terminalId: payload.terminalId, data: payload.data },
      };
    }
    if (method === 'terminalExit') {
      if (typeof payload.code !== 'number') return null;
      return {
        method,
        payload: { terminalId: payload.terminalId, code: payload.code },
      };
    }
    if (method === 'terminalFrame') {
      if (typeof payload.frame !== 'string') return null;
      if (typeof payload.instance !== 'string') return null;
      if (typeof payload.at !== 'number' || !Number.isFinite(payload.at)) return null;
      return {
        method,
        payload: {
          terminalId: payload.terminalId,
          frame: payload.frame,
          instance: payload.instance,
          at: payload.at,
        },
      };
    }
    // terminalInputActivity
    if (typeof payload.peerId !== 'string') return null;
    if (typeof payload.timestamp !== 'number') return null;
    if (typeof payload.bytes !== 'number') return null;
    return {
      method,
      payload: {
        terminalId: payload.terminalId,
        peerId: payload.peerId,
        timestamp: payload.timestamp,
        bytes: payload.bytes,
      },
    };
  } catch {
    return null;
  }
}
