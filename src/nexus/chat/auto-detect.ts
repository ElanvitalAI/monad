// NEXUS · chat backend auto-detection (N-1 cleanup PR g.1).
//
// PR g.1 flipped the hard default from 'claude-code' to 'none' so a
// clean-machine new user gets graceful Quick Setup guidance instead
// of a silent ACP-spawn failure. To balance, the boot path probes the
// machine for an OAuth token / API key and wires the matching ACP
// backend automatically when found — the user never sees the 'none'
// placeholder if any of the 3 supported providers (codex / claude-
// code / gemini) is already authenticated.
//
// Detection priority (first-match-wins):
//
//    1. OpenAI Codex OAuth   (loadTokens('openai-codex'))    → 'codex'
//    2. OPENAI_API_KEY env    (codex API fallback)            → 'codex'
//    3. ANTHROPIC_API_KEY env (claude-code CLI handles auth)  → 'claude-code'
//    4. GEMINI_API_KEY /       (gemini-cli --experimental-acp) → 'gemini'
//       GOOGLE_API_KEY env
//    (none)                                                   → 'none'
//
// Why this order:
//   - Codex OAuth is the only first-class OAuth path inside elanous-
//     agent (loadTokens canonical store). It's the lowest-friction
//     auth so it wins when present.
//   - OPENAI_API_KEY is the most common API-key env in the wild
//     (most LLM tooling sets it) — when both an OPENAI key and
//     ANTHROPIC key are present, codex still wins because the CLI
//     spawn cost is comparable + codex's tooling parity is broader
//     under the current ACP shim landscape.
//   - GEMINI is third because gemini-cli @experimental-acp is the
//     newest of the three wraps + has had the least dogfood.
//   - Grok / OpenAI direct / Anthropic direct (in-process LLM call,
//     no ACP) are out of scope for chat — those run in the daemon
//     tab. NEXUS chat is ACP-only by current design.
//
// Test seam: every dependency that touches global state can be DI'd
// (`opts.envSource`, `opts.tokenLookup`). The default delegates to
// process.env + loadTokens.

import type { ChatBackendKind } from './backend-resolver.js';
import { loadTokens } from '../../oauth/store.js';

export interface DetectChatBackendOpts {
  /** Override env-var lookup. Production omits + we read process.env;
   *  tests pass a synthetic env so the priority can be exercised
   *  deterministically without leaking host secrets. */
  envSource?: NodeJS.ProcessEnv;
  /** Override the OAuth token store probe. Production omits + we
   *  delegate to `loadTokens`; tests pass a stub that returns
   *  truthy/falsy without touching disk. */
  tokenLookup?: (provider: string) => unknown | null;
}

export interface ChatBackendDetection {
  /** The backend the boot wire should use (or 'none' when nothing
   *  matched). */
  backend: ChatBackendKind;
  /** Human-readable source — used in the boot banner so the user
   *  can verify which credential path won. Empty for 'none'. */
  source: string;
}

/** Probe the environment + OAuth store for an authenticated provider
 *  and return the chat backend kind to wire. Returns `'none'` when
 *  nothing matches — the caller (runNexus chat-session bootstrap)
 *  treats that as inert and the chat tab placeholder surfaces the
 *  Quick Setup guidance.
 *
 *  Priority documented at the top of this file. */
export function detectChatBackend(
  opts: DetectChatBackendOpts = {},
): ChatBackendDetection {
  const env = opts.envSource ?? process.env;
  const probeToken = opts.tokenLookup ?? ((p) => loadTokens(p));

  // 1. Codex OAuth — canonical first-class path.
  if (probeToken('openai-codex')) {
    return { backend: 'codex', source: 'openai-codex OAuth' };
  }
  // 2. OPENAI_API_KEY — codex API fallback.
  if (nonEmpty(env['OPENAI_API_KEY'])) {
    return { backend: 'codex', source: 'OPENAI_API_KEY env' };
  }
  // 3. ANTHROPIC_API_KEY — claude-code CLI handles auth itself, but
  //    the env-var presence is the strongest signal we have that the
  //    user wants the Anthropic surface.
  if (nonEmpty(env['ANTHROPIC_API_KEY'])) {
    return { backend: 'claude-code', source: 'ANTHROPIC_API_KEY env' };
  }
  // 4. GEMINI_API_KEY / GOOGLE_API_KEY — gemini-cli accepts either.
  if (nonEmpty(env['GEMINI_API_KEY']) || nonEmpty(env['GOOGLE_API_KEY'])) {
    const which = nonEmpty(env['GEMINI_API_KEY']) ? 'GEMINI_API_KEY' : 'GOOGLE_API_KEY';
    return { backend: 'gemini', source: `${which} env` };
  }
  return { backend: 'none', source: '' };
}

function nonEmpty(v: string | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}
