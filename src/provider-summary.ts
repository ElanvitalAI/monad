// ── Provider summary helpers ──
//
// One-line human-readable descriptions of the currently-active LLM
// provider + model, designed for rendering in three surfaces:
//   1. `monad provider` CLI — full status dump
//   2. Dashboard launch banner (index.ts main)
//   3. Chat footer / HUD insert
//
// Keeps "what am I actually talking to right now?" one command or one
// glance away. Without this, the user has to cat config.json to
// check, which is the opposite of a 1-point experience.

import { resolveGrokCredential } from './grok/credential.js';
import { decideProviderForConfig, type ProviderDecision } from './llm.js';
import { getUserConfig, type UserConfig } from './user-config.js';
import { loadTokens, isExpiringSoon } from './oauth/store.js';
import { CODEX_REFRESH_BUFFER_MS } from './oauth/codex.js';
import { findCodexModel } from './codex/models.js';
import { getLocalLLMUrl } from './config.js';

export type AuthKind = 'oauth' | 'apikey' | 'local' | 'none';

export interface ActiveProviderInfo {
  provider: string;        // 'openai-codex', 'grok', ... or 'auto:<resolved>'
  model: string;
  auth: AuthKind;
  /** Human-readable auth detail, e.g. 'OAuth — 58min left', 'API key
   *  (env)', 'local — localhost:11434'. */
  authDetail: string;
  /** Extra context — e.g. Codex model description. */
  note?: string;
}

/** Resolve which provider would actually be used right now. Honors
 *  userConfig first, falls through to the shared provider decision without
 *  constructing a provider object; this layer only formats human-readable auth detail. */
export function inspectActiveProvider(
  cfg: UserConfig = getUserConfig(),
  runtimeModel?: string,
): ActiveProviderInfo {
  const decision = decideProviderForConfig(cfg);
  const { apiKey, baseUrl } = cfg.llm;
  const { provider, model: configuredModel, auth } = decision;
  // A backend may resolve a configured alias to a different concrete model.
  // Show only a server-confirmed runtime value; fall back to configuration
  // until the backend has supplied one.
  const model = runtimeModel?.trim() || configuredModel;
  const catalogHit = provider === 'openai-codex' ? findCodexModel(model) : undefined;
  const note = catalogHit ? `${catalogHit.label} — ${catalogHit.description.slice(0, 70)}${catalogHit.description.length > 70 ? '…' : ''}` : undefined;
  return {
    provider,
    model,
    auth,
    authDetail: authDetailForDecision(decision, { apiKey, baseUrl }),
    ...(note ? { note } : {}),
  };
}

function authDetailForDecision(
  decision: ProviderDecision,
  llm: { apiKey?: string; baseUrl?: string },
): string {
  const { provider, model, auth } = decision;
  if (provider === 'openai-codex') {
    if (auth === 'oauth') {
      const tokens = loadTokens('openai-codex');
      const exp = tokens?.tokens.expiresAt;
      const exWhen = exp != null
        ? (Date.now() > exp ? 'EXPIRED (will auto-refresh)' : `~${Math.round((exp - Date.now()) / 60000)}min left`)
        : 'no expiry';
      const refreshing = tokens ? exp != null && isExpiringSoon(tokens, CODEX_REFRESH_BUFFER_MS) : false;
      return `OAuth — ${exWhen}${refreshing ? ' (refreshing soon)' : ''}`;
    }
    return auth === 'apikey'
      ? 'API key (config)'
      : 'not configured — run `monad login openai-codex` or `monad codex setup`';
  }
  if (provider === 'grok') {
    if (auth === 'oauth') return '구독 OAuth (~/.grok/auth.json · `grok login`)';
    if (auth === 'apikey') {
      const cred = resolveGrokCredential({ model });
      if (cred?.kind === 'api_key') return `API key (env ${cred.source})`;
      return llm.apiKey ? 'API key (config)' : 'API key (env)';
    }
    return 'not configured';
  }
  if (provider === 'openai') {
    return auth === 'apikey'
      ? llm.apiKey ? 'API key (config)' : 'API key (env OPENAI_API_KEY)'
      : 'not configured';
  }
  if (provider === 'anthropic') {
    return auth === 'apikey'
      ? llm.apiKey ? 'API key (config)' : 'API key (env ANTHROPIC_API_KEY)'
      : 'not configured';
  }
  if (provider === 'gemini') {
    return auth === 'apikey'
      ? llm.apiKey ? 'API key (config)' : 'API key (env GEMINI_API_KEY / GOOGLE_API_KEY)'
      : 'not configured';
  }
  // ⛔ 2026-09-23 — 종전엔 여기 칸이 없어 provider=openrouter 가 「no provider configured」로 «거짓» 표시됐다.
  if (provider === 'openrouter') {
    return auth === 'apikey'
      ? llm.apiKey ? 'API key (config)' : 'API key (~/.cache/openrouter_api_key · env OPENROUTER_API_KEY)'
      : 'not configured — bash scripts/add-api-key.sh OPENROUTER_API_KEY';
  }
  if (provider === 'local') {
    const url = llm.baseUrl || getLocalLLMUrl();
    return auth === 'local' && url ? `OpenAI-compat endpoint — ${url}` : 'not configured — set llm.baseUrl';
  }
  if (provider === 'auto:openai-codex') return auth === 'oauth' ? 'OAuth — auto subscription-first (openai-codex)' : 'not configured';
  if (provider === 'auto:grok') {
    if (auth === 'oauth') return '구독 OAuth (~/.grok/auth.json · `grok login`)';
    if (auth === 'apikey') {
      const cred = resolveGrokCredential({ model });
      return cred ? `API key (env ${cred.source})` : 'API key (env XAI_API_KEY / GROK_API_KEY)';
    }
    return 'not configured';
  }
  if (provider === 'auto:openai') return auth === 'apikey' ? 'API key (env OPENAI_API_KEY)' : 'not configured';
  if (provider === 'auto:anthropic') return auth === 'apikey' ? 'API key (env ANTHROPIC_API_KEY)' : 'not configured';
  if (provider === 'auto:gemini') return auth === 'apikey' ? 'API key (env GEMINI_API_KEY / GOOGLE_API_KEY)' : 'not configured';
  if (provider === 'auto:local') return auth === 'local' ? `OpenAI-compat endpoint — ${getLocalLLMUrl()}` : 'not configured — set LOCAL_LLM_URL';
  return 'no provider configured — run `monad setup` or set an API-key env var';
}

// ── Renderers ────────────────────────────────────────────────────────

/** One-line summary suitable for HUD / banner contexts.
 *  Example: "provider: openai-codex / gpt-5.4-mini · OAuth — ~47min left" */
export function oneLineProvider(info: ActiveProviderInfo = inspectActiveProvider()): string {
  return `provider: ${info.provider} / ${info.model} · ${info.authDetail}`;
}

/** Multi-line summary for `monad provider` and `/provider` slash
 *  command. Includes the Codex model blurb when applicable. */
export function renderProviderStatus(info: ActiveProviderInfo = inspectActiveProvider()): string {
  const lines: string[] = [];
  lines.push(`  provider : ${info.provider}`);
  lines.push(`  model    : ${info.model}`);
  lines.push(`  auth     : ${info.authDetail}`);
  if (info.note) lines.push(`  note     : ${info.note}`);
  if (info.auth === 'none') {
    lines.push('');
    lines.push('  Fix: run `monad setup` (wizard) or `monad codex setup` (1-point Codex)');
  }
  return lines.join('\n');
}
