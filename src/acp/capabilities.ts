// ACP H2 #4 — PromptCapabilities + version negotiation.
//
// Today monad's ACP client logs but discards `response.agentCapabilities`
// from the initialize handshake; the server hard-codes its capability
// reply. This module is the single source of truth for:
//
//   1. Parsing a peer's AgentCapabilities into a normalized
//      MonadCapabilities shape (missing fields → conservative false).
//   2. Declaring monad's own capabilities (as client + as server) so
//      client.ts and server.ts stop repeating themselves.
//   3. Per-brand defaults — expected capability profile for each
//      pinned backend (claude-code · codex · gemini). Used as
//      pre-init fallback + regression baseline.
//   4. Version compatibility check — throw a typed error instead of
//      silently proceeding on protocol-version mismatch.
//
// Reference (Warp primary per user 2026-04-22): warp.dev/blog/how-warp-
//   works documents Warp's feature matrix + agent-specific capability
//   gating. The shape here mirrors that intent — the `planMode`
//   derived flag preps for Warp plan-mode approval UX once backends
//   advertise a session-mode capability.
// Reference (Zed): crates/agent_servers/src/acp.rs initialize flow
//   captures `agentCapabilities` per-session and feature-gates its UI
//   against it. We port the capture + gating shape, leaving the UI
//   gate wiring for H2 #5 / H3 consumers.
// Reference (ACP SDK 0.14.1 canonical wire types):
//   AgentCapabilities = { loadSession?, mcpCapabilities?,
//     promptCapabilities?: { audio?, embeddedContext?, image? },
//     sessionCapabilities? }
//   ClientCapabilities = { fs: { readTextFile, writeTextFile }, terminal }
//   ProtocolVersion = number (currently 1)

import {
  PROTOCOL_VERSION as SDK_PROTOCOL_VERSION,
  type AgentCapabilities,
  type ClientCapabilities,
  type ProtocolVersion,
} from '@agentclientprotocol/sdk';
import { debug } from '../debug/log.js';
import {
  isVisionCapableModel,
  type LlmBrand,
} from '../llm-vision-capability.js';
import {
  MONAD_UI_DISABLED,
  MONAD_TERM_DISABLED,
  parseMonadUiCapabilities,
  parseMonadTermCapabilities,
  type MonadUiClientCapabilities,
  type MonadTermClientCapabilities,
} from './monad-extensions.js';
import {
  MONAD_ASK_DISABLED,
  parseMonadAskCapabilities,
  type MonadAskClientCapabilities,
} from './ask-extensions.js';

export interface MonadPromptCapabilities {
  /** Always true per ACP baseline. */
  text: true;
  /** Always true per ACP baseline (ContentBlock::ResourceLink). */
  resourceLink: true;
  image: boolean;
  audio: boolean;
  embeddedContext: boolean;
  /** PR9 (2026-05-14) — video content block (PR7 schema · PR8 routing).
   *  Server advertises true (Gemini 1.5+ family routes natively · others
   *  graceful placeholder). Peer (client) reads to decide whether to
   *  send video block vs key-frame extraction (iOS PR10 toggle). */
  video: boolean;
}

export interface MonadFileOpsCapabilities {
  readTextFile: boolean;
  writeTextFile: boolean;
}

/** Session operations the peer advertised during initialize. `resume` is
 * distinct from `loadSession`: ACP resume does not return prior messages. */
export interface MonadSessionCapabilities {
  fork: boolean;
  list: boolean;
  resume: boolean;
}

/** MCP transports the peer advertised during initialize. */
export interface MonadMcpCapabilities {
  http: boolean;
  sse: boolean;
}

export interface MonadCapabilities {
  /** Peer's declared (or our own) protocol version. */
  protocolVersion: ProtocolVersion;
  prompt: MonadPromptCapabilities;
  /** Does the peer support `session/load` RPC? (H2 #5 gate.) */
  loadSession: boolean;
  /** Session operation advertisements, normalized to false when absent. */
  session: MonadSessionCapabilities;
  /** MCP transport advertisements, normalized to false when absent. */
  mcp: MonadMcpCapabilities;
  /** File-ops — only meaningful on the client side (our client
   *  advertises fs callbacks the agent can call). When applied to a
   *  peer agent, these stay at wire defaults. */
  fileOps: MonadFileOpsCapabilities;
  /** Plan-mode — monad-side aggregate flag. Not yet expressible in
   *  the wire format (no backend declares it); reserved for Warp-
   *  parity arcs. */
  planMode: boolean;
  /** UI-Core arc Phase U2 — `monad/ui/*` extension methods. Peers that
   *  don't advertise these stay at conservative off; monad-as-server
   *  gates `showModal` / `showToast` / `updateStatusPill` on them. */
  ui: MonadUiClientCapabilities;
  /** WT-S-1 — `monad/term/*` extension methods. Sibling to `ui`.
   *  Web/PWA peers advertise full caps; TUI / vanilla ACP peers stay
   *  off so envelope text never leaks into their `agent_thought_chunk`
   *  rendering. */
  term: MonadTermClientCapabilities;
  /** AskUserQuestion cross-surface arc (2026-05-13) — `monad/ask/*`
   *  extMethod. Peers advertise `_meta.monad.ask.askUserQuestion=true`
   *  when they can render a native structured-choice sheet. Server gates
   *  AskUserQuestion fan-out on this cap (dispatchAskUserQuestion 의
   *  resolver path 가 cap-able peer 가진 sessionId 에만 push). */
  ask: MonadAskClientCapabilities;
}

export interface MonadCapabilityDeclaration {
  protocolVersion: ProtocolVersion;
  asAgent: AgentCapabilities;
  asClient: ClientCapabilities;
}

export interface NegotiatedCapabilities {
  protocolVersion: ProtocolVersion;
  prompt: {
    image: boolean;
    audio: boolean;
    embeddedContext: boolean;
    /** PR9 (2026-05-14) — both sides claim video → caller (iOS PR10
     *  toggle 등) 가 native video block path 활성. */
    video: boolean;
  };
  loadSession: boolean;
  planMode: boolean;
  ui: MonadUiClientCapabilities;
  term: MonadTermClientCapabilities;
}

/** Thrown by the ACP client (or anyone calling `checkProtocolVersion`)
 *  when local + peer versions disagree. Carries both sides so callers
 *  can branch without re-parsing the message. */
export class AcpProtocolVersionError extends Error {
  readonly local: ProtocolVersion;
  readonly peer: ProtocolVersion;
  constructor(local: ProtocolVersion, peer: ProtocolVersion) {
    super(
      `ACP protocol version mismatch: monad speaks ${local} but peer advertised ${peer}. ` +
        `Update @agentclientprotocol/sdk or the backend package to re-align.`,
    );
    this.name = 'AcpProtocolVersionError';
    this.local = local;
    this.peer = peer;
  }
}

/** H2 #5 — thrown by `AcpAgent.loadSession()` when the peer didn't
 *  advertise `AgentCapabilities.loadSession: true` at initialize time.
 *  Surfaces to `AcpSessionResume` LLM callers as a clean typed error
 *  instead of a silent skip. */
export class AcpLoadSessionUnsupportedError extends Error {
  readonly backendId: string;
  constructor(backendId: string) {
    super(
      `ACP backend '${backendId}' does not advertise loadSession capability. ` +
        `Resume is not supported for this session — start a fresh conversation instead.`,
    );
    this.name = 'AcpLoadSessionUnsupportedError';
    this.backendId = backendId;
  }
}

/** Thrown by `AcpAgent.resumeSession()` when the peer did not advertise
 * `AgentCapabilities.sessionCapabilities.resume` during initialization. */
export class AcpResumeSessionUnsupportedError extends Error {
  readonly backendId: string;
  constructor(backendId: string) {
    super(`ACP backend '${backendId}' does not advertise session.resume capability.`);
    this.name = 'AcpResumeSessionUnsupportedError';
    this.backendId = backendId;
  }
}

/** Thrown by `AcpAgent.forkSession()` when the peer did not advertise
 * `AgentCapabilities.sessionCapabilities.fork` during initialization. */
export class AcpForkSessionUnsupportedError extends Error {
  readonly backendId: string;
  constructor(backendId: string) {
    super(`ACP backend '${backendId}' does not advertise session.fork capability.`);
    this.name = 'AcpForkSessionUnsupportedError';
    this.backendId = backendId;
  }
}

/** Thrown by `AcpAgent.listSessions()` when the peer did not advertise
 * `AgentCapabilities.sessionCapabilities.list` during initialization. */
export class AcpListSessionsUnsupportedError extends Error {
  readonly backendId: string;
  constructor(backendId: string) {
    super(`ACP backend '${backendId}' does not advertise session.list capability.`);
    this.name = 'AcpListSessionsUnsupportedError';
    this.backendId = backendId;
  }
}

/** Conservative baseline — what every ACP peer supports per protocol
 *  spec, before any extras. All optional fields default off. */
const CONSERVATIVE_BASELINE: Omit<MonadCapabilities, 'protocolVersion'> = {
  prompt: {
    text: true,
    resourceLink: true,
    image: false,
    audio: false,
    embeddedContext: false,
    video: false,
  },
  loadSession: false,
  session: { fork: false, list: false, resume: false },
  mcp: { http: false, sse: false },
  fileOps: {
    readTextFile: false,
    writeTextFile: false,
  },
  planMode: false,
  ui: { ...MONAD_UI_DISABLED },
  term: { ...MONAD_TERM_DISABLED },
  ask: { ...MONAD_ASK_DISABLED },
};

/** Per-brand expected capability profile. Derived from the currently
 *  pinned package behavior (2026-04-22). Callers use this as the
 *  pre-init fallback + as "what we expect" for future regression
 *  alerts. The real runtime value comes from `parsePeerCapabilities`
 *  applied to the live initialize response. */
const BRAND_DEFAULTS: Record<string, Partial<Omit<MonadCapabilities, 'protocolVersion'>>> = {
  // claude-code-acp 0.16.2: text + resource_link, no image/audio,
  // no session/load.
  claude: {},
  // codex-acp 0.11.1: same as claude for now.
  codex: {},
  // gemini --experimental-acp (@google/gemini-cli 0.38.0): accepts
  // inline images in prompts, but no session/load or embedded context.
  // PR9 (2026-05-14) — Gemini 1.5+ family supports native video via
  // inlineData (mp4/quicktime/webm 등 · ai.google.dev/gemini-api/docs/
  // vision#video). monad routes to messagesToGeminiInput.
  gemini: {
    prompt: {
      text: true,
      resourceLink: true,
      image: true,
      audio: false,
      embeddedContext: false,
      video: true,
    },
  },
};

/** Per-brand baseline profile. Unknown brand → pure conservative.
 *  Exported so consumers can use it as a fallback before initialize
 *  completes (e.g. pre-spawn UX hints). */
export function defaultAgentCapabilities(brand: string): MonadCapabilities {
  const overrides = BRAND_DEFAULTS[brand] ?? {};
  return {
    protocolVersion: SDK_PROTOCOL_VERSION,
    prompt: { ...CONSERVATIVE_BASELINE.prompt, ...overrides.prompt },
    loadSession: overrides.loadSession ?? CONSERVATIVE_BASELINE.loadSession,
    session: { ...CONSERVATIVE_BASELINE.session, ...(overrides.session ?? {}) },
    mcp: { ...CONSERVATIVE_BASELINE.mcp, ...(overrides.mcp ?? {}) },
    fileOps: { ...CONSERVATIVE_BASELINE.fileOps, ...overrides.fileOps },
    planMode: overrides.planMode ?? CONSERVATIVE_BASELINE.planMode,
    ui: { ...CONSERVATIVE_BASELINE.ui, ...(overrides.ui ?? {}) },
    term: { ...CONSERVATIVE_BASELINE.term, ...(overrides.term ?? {}) },
    ask: { ...CONSERVATIVE_BASELINE.ask, ...(overrides.ask ?? {}) },
  };
}

/** Parse a live peer response into normalized MonadCapabilities. Safe
 *  against undefined / empty peer blob (legacy peer → all optional
 *  flags false, text + resourceLink on). */
export function parsePeerCapabilities(
  peer: AgentCapabilities | undefined | null,
  protocolVersion: ProtocolVersion,
): MonadCapabilities {
  const prompt = peer?.promptCapabilities;
  // PR9 (2026-05-14) — SDK 0.14.1 의 PromptCapabilities 타입에 video
  // 미정의. 자체 advertise + forward-compat peer 의 video advertise 를
  // 둘 다 흡수하려고 `as unknown as` 캐스트로 video 키 lookup.
  const promptExt = prompt as unknown as { video?: boolean } | undefined;
  return {
    protocolVersion,
    prompt: {
      text: true,
      resourceLink: true,
      image: prompt?.image === true,
      audio: prompt?.audio === true,
      embeddedContext: prompt?.embeddedContext === true,
      video: promptExt?.video === true,
    },
    loadSession: peer?.loadSession === true,
    session: {
      fork: peer?.sessionCapabilities?.fork != null,
      list: peer?.sessionCapabilities?.list != null,
      resume: peer?.sessionCapabilities?.resume != null,
    },
    mcp: {
      http: peer?.mcpCapabilities?.http === true,
      sse: peer?.mcpCapabilities?.sse === true,
    },
    fileOps: {
      // AgentCapabilities doesn't carry fs capabilities — those live
      // on the CLIENT side. Peer-parsed fileOps always false.
      readTextFile: false,
      writeTextFile: false,
    },
    planMode: false,
    ui: { ...MONAD_UI_DISABLED },
    term: { ...MONAD_TERM_DISABLED },
    ask: { ...MONAD_ASK_DISABLED },
  };
}

/** UI-Core arc Phase U2 — parse a client's full ClientCapabilities
 *  (including the `_meta` extension blob) into MonadCapabilities
 *  shape. Used by the ACP server to decide whether it may push
 *  `monad/ui/*` envelopes. */
export function parseClientCapabilities(
  client: ClientCapabilities | undefined | null,
  protocolVersion: ProtocolVersion,
): MonadCapabilities {
  const fs = client?.fs;
  const meta = (client as unknown as { _meta?: unknown } | null | undefined)?._meta;
  return {
    protocolVersion,
    prompt: { ...CONSERVATIVE_BASELINE.prompt },
    loadSession: false,
    session: { ...CONSERVATIVE_BASELINE.session },
    mcp: { ...CONSERVATIVE_BASELINE.mcp },
    fileOps: {
      readTextFile: fs?.readTextFile === true,
      writeTextFile: fs?.writeTextFile === true,
    },
    planMode: false,
    ui: parseMonadUiCapabilities(meta),
    term: parseMonadTermCapabilities(meta),
    ask: parseMonadAskCapabilities(meta),
  };
}

/** Build the ClientCapabilities object monad-as-client advertises
 *  during initialize. Today monad doesn't implement fs callbacks, so
 *  the defaults are strict-off · callers can override. */
export function buildClientDeclaration(
  opts: {
    fs?: Partial<MonadFileOpsCapabilities>;
    terminal?: boolean;
  } = {},
): ClientCapabilities {
  return {
    fs: {
      readTextFile: opts.fs?.readTextFile === true,
      writeTextFile: opts.fs?.writeTextFile === true,
    },
    terminal: opts.terminal === true,
  };
}

/** Build the AgentCapabilities object monad-as-server advertises.
 *  `buildDeclaration()` below and `runAcpServer()`'s `initialize()` handler
 *  in server.ts call this builder; the latter returns its declaration to
 *  external ACP clients.
 *
 *  M2.3 — `loadSession` is now ON. The server-side handler is wired
 *  (`acpServerLoadSession` + `runAcpServer({ hasSession })`); unknown
 *  ids return a typed error rather than silently mint a fresh
 *  session. `loadSession: false` callers (rare) can pass
 *  `{ loadSession: false }` to suppress the advertisement. */
type AgentDeclarationOptions = {
  loadSession?: boolean;
  video?: boolean;
} & (
  | { brand: LlmBrand; model: string }
  | { brand?: never; model?: never }
);

export function buildAgentDeclaration(
  opts: AgentDeclarationOptions = {},
): AgentCapabilities {
  if ((opts.brand === undefined) !== (opts.model === undefined)) {
    throw new TypeError('ACP image declaration requires both brand and model');
  }
  // ACP image capability follows the existing user-message wire decision.
  // Without a complete identity, omit ACP's optional image field rather than
  // asserting that the active route is image-incapable.
  const image = opts.brand !== undefined
    ? isVisionCapableModel(opts.brand, opts.model, 'userMessage')
    : undefined;
  // PR9 (2026-05-14) — SDK 0.14.1 PromptCapabilities 타입에 video 미정의.
  // monad-as-server 가 video block 을 받아서 capable provider (Gemini
  // 1.5+) 한테 native passthrough · 그 외 graceful placeholder 라우팅
  // 하므로 video=true advertise. SDK 타입 통과를 위해 spread + cast.
  const declareVideo = opts.video ?? true;
  const promptCaps = {
    ...(image === undefined ? {} : { image }),
    audio: false,
    embeddedContext: false,
    ...(declareVideo ? { video: true } : {}),
  } as unknown as AgentCapabilities['promptCapabilities'];
  return {
    loadSession: opts.loadSession ?? true,
    promptCapabilities: promptCaps,
  };
}

/** Full monad declaration used at both ends of the pairing. */
export function buildDeclaration(
  clientOpts?: Parameters<typeof buildClientDeclaration>[0],
): MonadCapabilityDeclaration {
  return {
    protocolVersion: SDK_PROTOCOL_VERSION,
    asAgent: buildAgentDeclaration(),
    asClient: buildClientDeclaration(clientOpts),
  };
}

/** Intersection — a feature survives only if both sides claim it.
 *  ProtocolVersion resolves to the minimum (lower version is the
 *  safe common denominator). */
export function negotiate(
  local: MonadCapabilities,
  peer: MonadCapabilities,
): NegotiatedCapabilities {
  return {
    protocolVersion: Math.min(local.protocolVersion, peer.protocolVersion),
    prompt: {
      image: local.prompt.image && peer.prompt.image,
      audio: local.prompt.audio && peer.prompt.audio,
      embeddedContext: local.prompt.embeddedContext && peer.prompt.embeddedContext,
      video: local.prompt.video && peer.prompt.video,
    },
    loadSession: local.loadSession && peer.loadSession,
    planMode: local.planMode && peer.planMode,
    ui: {
      showModal: local.ui.showModal && peer.ui.showModal,
      showToast: local.ui.showToast && peer.ui.showToast,
      updateStatusPill: local.ui.updateStatusPill && peer.ui.updateStatusPill,
      usage: local.ui.usage && peer.ui.usage,
    },
    term: {
      terminalOutput: local.term.terminalOutput && peer.term.terminalOutput,
      terminalExit: local.term.terminalExit && peer.term.terminalExit,
      // ⭐P2 (capture substrate) — both ends must support the terminalFrame
      // mirror for the effective cap to hold. Optional-undefined → false.
      terminalFrame: (local.term.terminalFrame ?? false) && (peer.term.terminalFrame ?? false),
    },
  };
}

/** Returns null when versions agree, or a typed error the caller can
 *  throw. Keeping throw at the call-site lets skill-tool / server
 *  branch differently without wrapping in try/catch. */
export function checkProtocolVersion(
  local: ProtocolVersion,
  peer: ProtocolVersion,
): AcpProtocolVersionError | null {
  if (local === peer) return null;
  if (debug.enabled) {
    debug.log('acp.capabilities.version-mismatch', `local=${local} peer=${peer}`, {
      local,
      peer,
    });
  }
  return new AcpProtocolVersionError(local, peer);
}

/** Convenience — matches PROTOCOL_VERSION re-export pattern the SDK
 *  uses. Kept so consumers import from one module. */
export const MONAD_PROTOCOL_VERSION: ProtocolVersion = SDK_PROTOCOL_VERSION;
