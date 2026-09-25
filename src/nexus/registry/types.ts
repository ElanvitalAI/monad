// NEXUS · subsystem registry types (Phase N-3.5 PR τ)
//
// "Binding" = a routing entry from an external addressable identity
// (e.g., Pushcut webhook token, Discord channel id, Slack workspace id,
// Pushover device, generic webhook URL) to a NEXUS-side recipient
// (chat session id, tab id, custom label).
//
// Channels are namespaces that group related bindings together. Each
// subsystem owns its own channel (no cross-channel collisions).

export const BINDING_FILE_VERSION = 1;

export interface Binding {
  /** The external identity within the channel (e.g., webhook token,
   *  channel id, device token). Validated against SAFE_KEY_RE. */
  key: string;
  /** Optional NEXUS chat session id this binding routes to. Other
   *  binding types may leave this empty (e.g., a webhook that creates
   *  a *new* session per call). */
  sessionId?: string;
  /** Optional human-readable label (sidebar UI). */
  label?: string;
  /** Free-form per-subsystem metadata. NEXUS treats it as an opaque
   *  object — subsystems define their own schema. */
  meta?: Record<string, unknown>;
  /** ISO timestamp of last write. Set by the store automatically. */
  updatedAt: string;
}

export interface BindingChannel {
  version: typeof BINDING_FILE_VERSION;
  /** Channel name (e.g., 'pushcut', 'discord', 'slack', 'pushover'). */
  channel: string;
  /** Optional human description shown in the registry list endpoint. */
  description?: string;
  bindings: Record<string, Binding>;
}

export interface ChannelSummary {
  channel: string;
  description?: string;
  bindingCount: number;
}

export class BindingStoreError extends Error {
  constructor(public readonly channel: string, public readonly key: string | null, message: string) {
    super(`[binding ${channel}${key ? `/${key}` : ''}] ${message}`);
    this.name = 'BindingStoreError';
  }
}

export const SAFE_CHANNEL_RE = /^[a-z][a-z0-9_-]{0,63}$/;
export const SAFE_KEY_RE = /^[A-Za-z0-9_:./~-]{1,256}$/;

export function validateChannel(channel: string): string | null {
  if (!SAFE_CHANNEL_RE.test(channel)) {
    return 'channel must match /^[a-z][a-z0-9_-]{0,63}$/';
  }
  return null;
}

export function validateKey(key: string): string | null {
  if (!SAFE_KEY_RE.test(key)) {
    return 'key must match /^[A-Za-z0-9_:./~-]{1,256}$/';
  }
  return null;
}
