// ── JWT decode for OpenAI OAuth claims ──
//
// The ChatGPT Codex backend at chatgpt.com/backend-api/codex requires a
// `chatgpt-account-id` header routed from claims embedded in the
// access-token JWT. The claims live under a nested path:
//
//   payload["https://api.openai.com/auth"] = {
//     chatgpt_account_id: "<uuid>",
//     chatgpt_plan_type:  "pro" | "plus" | "team",
//     chatgpt_user_id:    "<uuid>",
//   }
//
// We intentionally do NOT verify the JWT signature — the token was
// issued to us by OpenAI's own OAuth server and is used only to read
// our own public claims. No trust decision rides on the payload; the
// bearer itself is what authenticates the request.
//
// Malformed tokens degrade gracefully to null, which the fetch path
// translates into "omit the chatgpt-account-id header". API-key users
// (no JWT access token at all) hit the same branch.
//
// Source of truth for the claim path + header name: the official Codex
// CLI (openai/codex) and the opencode-openai-codex-auth plugin, both
// confirmed via an omni-crawl sweep of developers.openai.com/codex/auth,
// lib.rs/crates/codex-oauth, and pkg.go.dev/.../llms/oauth (2026-04).

export const JWT_CLAIM_PATH = 'https://api.openai.com/auth';

export interface ChatGPTClaims {
  accountId: string;
  planType?: string;
  userId?: string;
}

/** Decode a JWT payload without signature verification. Returns the
 *  parsed object, or null on any structural error (wrong segment
 *  count, invalid base64url, non-JSON body, non-object root). Callers
 *  treat null the same as "no usable claims". */
export function decodeJWTPayload(token: string): Record<string, unknown> | null {
  if (typeof token !== 'string' || token.length === 0) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const seg = parts[1];
  if (!seg) return null;
  try {
    // base64url → base64 (RFC 4648 §5): `-`→`+`, `_`→`/`, then pad to
    // a multiple of 4 so Buffer's permissive base64 decoder accepts it.
    const normalized = seg.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf-8');
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Extract the three ChatGPT claims we care about from an access-token
 *  JWT. Returns null when the token has no payload, no nested claim
 *  path, or no accountId (the only required field — without it the
 *  Codex backend can't route to the user's subscription). */
export function extractChatGPTClaims(accessToken: string): ChatGPTClaims | null {
  const payload = decodeJWTPayload(accessToken);
  if (!payload) return null;
  const nested = payload[JWT_CLAIM_PATH];
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return null;
  const claims = nested as Record<string, unknown>;
  const accountId = typeof claims.chatgpt_account_id === 'string' ? claims.chatgpt_account_id : null;
  if (!accountId) return null;
  const planType = typeof claims.chatgpt_plan_type === 'string' ? claims.chatgpt_plan_type : undefined;
  const userId = typeof claims.chatgpt_user_id === 'string' ? claims.chatgpt_user_id : undefined;
  return { accountId, planType, userId };
}
