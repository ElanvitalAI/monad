// NEXUS · SSE heartbeat interval (shared by every SSE handler).
//
// Why 5s: ROADMAP §4.2 traced a ~12s client-side EventSource reconnect
// cycle to an idle-close upstream of the daemon (Bun.serve internals
// or Tailscale Serve TLS-tcp · cf. `reference_tailscale_serve_pwa`).
// Heartbeats at 25s/30s left longer-than-12s gaps in which the
// intermediary dropped the stream silently, surfacing as
// `intent.sse.error` log noise + transient event miss windows.
// Pinning the comment ping to 5s pushes traffic well under the
// observed idle threshold while staying a tiny ~12 packets/min cost.
//
// Single source of truth so future heartbeat tuning is one edit.
export const SSE_HEARTBEAT_MS = 5_000;
