// WT-N-3+N-4 Phase 2 — Pushcut PWA runtime hooks.
//
// Thin REST wrappers over NEXUS' canonical endpoint families:
//   - `/v1/config/secrets` (PR μ #1694) — HMAC secret rotate
//   - `/v1/registry/bindings/pushcut/<token>` (PR τ #1698) — token →
//     sessionId mapping CRUD
//
// Why a separate file (vs inline in SettingsPanel): the same hooks
// will be reused by the future trigger-camera button (WT-N-4
// follow-up) + binding inspector for Telegram/Discord bindings (PR
// τ explicitly designed for this generalisation). Centralised so
// shape drift can't sneak in across consumers.
//
// **NEXUS-only endpoints, NEXUS baseUrl** (NEXUS N-1.5 PR a · v6
// cutover): these endpoints live exclusively on the NEXUS HTTP
// server, and the PWA's `elanous.nexus.baseUrl` (post-rename) routes
// the underlying DaemonClient.fetchJson at the NEXUS port directly.
// Pre-cutover, the same DaemonClient pointed at `elanous.daemon.baseUrl`
// while the endpoints lived on NEXUS — fragile in production from
// PR #1702 until PR a landed (BACKLOG #19). Post-cutover, single-host
// assumption holds because NEXUS is the SSoT (cleanup arc N-1.5 v6).

import type { DaemonClient } from './daemon-client';

/** Pushcut HMAC secret id used in NEXUS' secret store. The webhook
 *  receiver (P1 daemon side) will look it up via `getSecretAsync`
 *  and HMAC-verify each inbound POST. */
export const PUSHCUT_SECRET_ID = 'pushcut-webhook';

/** Channel name for the subsystem registry. PR τ #1698 reserved
 *  this for Pushcut bindings — same store handles future Discord
 *  channel bindings, Slack workspace maps, etc. */
export const PUSHCUT_BINDING_CHANNEL = 'pushcut';

/** PR τ binding shape — `~/.elanous/nexus/bindings/pushcut.json`. */
export interface PushcutBinding {
  key: string;
  sessionId?: string;
  label?: string;
  meta?: Record<string, unknown>;
  updatedAt: string;
}

export interface ListBindingsResponse {
  channel: string;
  bindings: PushcutBinding[];
}

export interface UpsertBindingResponse {
  binding: PushcutBinding;
  outcome: 'created' | 'updated';
}

export interface RotateSecretResponse {
  stored: boolean;
  id: string;
  ref: string;
}

export interface DeleteBindingResponse {
  deleted: boolean;
  channel: string;
  key: string;
}

/** Reuse DaemonClient.fetchJson — auto-attaches Bearer auth from
 *  localStorage (`elanous.daemon.token`). Same baseUrl as daemon HTTP
 *  per the same-origin assumption documented above. */
export async function rotatePushcutSecret(
  client: DaemonClient,
  newValue: string,
): Promise<RotateSecretResponse> {
  return client.fetchJson<RotateSecretResponse>('/v1/config/secrets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: PUSHCUT_SECRET_ID, value: newValue }),
  });
}

/** PR τ list endpoint — channel filter narrows to pushcut bindings
 *  only. Returns `{channel, bindings: []}` when no bindings exist
 *  (channel still listed in summary but bindingCount=0). */
export async function listPushcutBindings(
  client: DaemonClient,
): Promise<ListBindingsResponse> {
  return client.fetchJson<ListBindingsResponse>(
    `/v1/registry/bindings?channel=${PUSHCUT_BINDING_CHANNEL}`,
  );
}

export interface UpsertBindingInput {
  /** Webhook token — will become the `key` in the registry. Must
   *  match `^[A-Za-z0-9_:./~-]{1,256}$` (PR τ SAFE_KEY_RE). */
  token: string;
  sessionId?: string;
  label?: string;
  meta?: Record<string, unknown>;
  /** PR τ default for PATCH is `mergeMeta:true`; POST defaults to
   *  replace. Caller can override. */
  mergeMeta?: boolean;
  /** PATCH for in-place edit (preserves missing fields), POST for
   *  full upsert. UI typically uses POST for new + PATCH for label
   *  edits. Default 'POST'. */
  method?: 'POST' | 'PATCH';
}

export async function upsertPushcutBinding(
  client: DaemonClient,
  input: UpsertBindingInput,
): Promise<UpsertBindingResponse> {
  const method = input.method ?? 'POST';
  const body: Record<string, unknown> = {};
  if (input.sessionId !== undefined) body.sessionId = input.sessionId;
  if (input.label !== undefined) body.label = input.label;
  if (input.meta !== undefined) body.meta = input.meta;
  if (input.mergeMeta !== undefined) body.mergeMeta = input.mergeMeta;
  return client.fetchJson<UpsertBindingResponse>(
    `/v1/registry/bindings/${PUSHCUT_BINDING_CHANNEL}/${encodeURIComponent(input.token)}`,
    {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

export async function deletePushcutBinding(
  client: DaemonClient,
  token: string,
): Promise<DeleteBindingResponse> {
  return client.fetchJson<DeleteBindingResponse>(
    `/v1/registry/bindings/${PUSHCUT_BINDING_CHANNEL}/${encodeURIComponent(token)}`,
    { method: 'DELETE' },
  );
}

/** Generates a 32-char URL-safe token (web-crypto). PR τ key regex
 *  `^[A-Za-z0-9_:./~-]{1,256}$` — alphanumeric + `_:./~-` allowed,
 *  so plain hex from crypto is safe. */
export function generatePushcutToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
