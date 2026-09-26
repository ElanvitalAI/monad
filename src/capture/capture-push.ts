// ── Phase D (Capture Fabric · multi-device) — Capture push dispatcher ──
//
// Send a captured PNG (or asciicast/gif/mp4 reference) to one or more
// remote sinks: Telegram chat, Discord webhook, PWA Web Push, iOS
// Pushcut endpoint. The dispatcher is provider-agnostic — each sink is
// implemented as a thin adapter that conforms to `CapturePushSink`.
//
// Why a separate file from the host adapters (telegram.ts · discord.ts)?
//   - Multi-device push composes *the same capture* across N sinks; the
//     host adapter knows its own protocol but not the others.
//   - Failures must be isolated per-sink — Telegram down ≠ Discord down.
//   - The push policy (which sinks to fan out to · caption template ·
//     downscale rules) lives in one place rather than scattered.
//
// Pure orchestrator: hosts inject sinks at boot. The dispatcher fans
// out, collects results, returns a per-sink outcome map.

export type CapturePushTargetKind = 'telegram' | 'discord' | 'pwa-push' | 'pushcut';

export interface CapturePushPayload {
  /** Base64-encoded image bytes (PNG / GIF / MP4 thumbnail). */
  readonly bodyBase64: string;
  /** MIME type of the payload. */
  readonly mimeType: 'image/png' | 'image/gif' | 'video/mp4';
  /** Optional human-readable caption — typically Phase A sidecar
   *  summary line (e.g. "capture: vw:1/build (observe-only) · intents=2"). */
  readonly caption?: string;
  /** Source surface identifier for telemetry / audit. */
  readonly surfaceLabel?: string;
  /** Wall-clock at capture. */
  readonly capturedAt: number;
}

export interface CapturePushSink {
  readonly kind: CapturePushTargetKind;
  /** Stable id for routing — telegram chatId · discord webhook id ·
   *  PWA subscription endpoint · pushcut device label. */
  readonly id: string;
  /** Send the payload. Throw → caught + recorded as failure. */
  send(payload: CapturePushPayload): Promise<void>;
}

export interface CapturePushOutcome {
  readonly kind: CapturePushTargetKind;
  readonly id: string;
  readonly status: 'sent' | 'failed' | 'skipped';
  readonly error?: string;
  readonly elapsedMs: number;
}

export interface CapturePushDispatcher {
  /** Register a sink. Idempotent on (kind, id). */
  register(sink: CapturePushSink): void;
  /** Drop a sink by (kind, id). Idempotent. */
  unregister(kind: CapturePushTargetKind, id: string): boolean;
  /** Fan out one payload to all registered sinks (or a filtered
   *  subset). Returns per-sink outcomes — caller decides what to log /
   *  retry / surface. */
  push(
    payload: CapturePushPayload,
    opts?: { filter?: (sink: CapturePushSink) => boolean },
  ): Promise<readonly CapturePushOutcome[]>;
  list(): readonly CapturePushSink[];
  size(): number;
}

function sinkKey(kind: CapturePushTargetKind, id: string): string {
  return `${kind}:${id}`;
}

export function createCapturePushDispatcher(opts: {
  now?: () => number;
  logDebug?: (category: string, event: string, data?: unknown) => void;
} = {}): CapturePushDispatcher {
  const now = opts.now ?? Date.now;
  const sinks = new Map<string, CapturePushSink>();
  const log = (category: string, event: string, data?: unknown): void => {
    if (opts.logDebug) opts.logDebug(category, event, data);
  };

  return {
    register(sink) {
      sinks.set(sinkKey(sink.kind, sink.id), sink);
      log('capture-push.register', sinkKey(sink.kind, sink.id));
    },
    unregister(kind, id) {
      const key = sinkKey(kind, id);
      const had = sinks.delete(key);
      if (had) log('capture-push.unregister', key);
      return had;
    },
    async push(payload, options = {}) {
      const all = Array.from(sinks.values());
      const targets = options.filter ? all.filter(options.filter) : all;
      if (targets.length === 0) {
        log('capture-push.no-targets', payload.surfaceLabel ?? '');
        return [];
      }
      log('capture-push.fanout', payload.surfaceLabel ?? '', { count: targets.length });
      const results = await Promise.all(
        targets.map(async (sink): Promise<CapturePushOutcome> => {
          const startedAt = now();
          try {
            await sink.send(payload);
            const elapsedMs = now() - startedAt;
            log('capture-push.sent', sinkKey(sink.kind, sink.id), { elapsedMs });
            return { kind: sink.kind, id: sink.id, status: 'sent', elapsedMs };
          } catch (err) {
            const elapsedMs = now() - startedAt;
            const error = String(err instanceof Error ? err.message : err);
            log('capture-push.failed', sinkKey(sink.kind, sink.id), { elapsedMs, error });
            return { kind: sink.kind, id: sink.id, status: 'failed', error, elapsedMs };
          }
        }),
      );
      return results;
    },
    list() {
      return Array.from(sinks.values());
    },
    size() {
      return sinks.size;
    },
  };
}

// ── Sink builders ─────────────────────────────────────────────────

/** Telegram sink — host injects the actual Bot API call. The dispatcher
 *  doesn't import telegram.ts directly so it stays small and testable. */
export function createTelegramCaptureSink(args: {
  chatId: number;
  sendPhoto: (chatId: number, payload: CapturePushPayload) => Promise<void>;
}): CapturePushSink {
  return {
    kind: 'telegram',
    id: String(args.chatId),
    async send(payload) {
      await args.sendPhoto(args.chatId, payload);
    },
  };
}

/** Discord webhook sink — multipart/form-data POST to webhook URL.
 *  Host injects the fetch impl for testability. */
export function createDiscordWebhookSink(args: {
  webhookUrl: string;
  fetchImpl: typeof fetch;
}): CapturePushSink {
  return {
    kind: 'discord',
    id: hashWebhookId(args.webhookUrl),
    async send(payload) {
      const form = new FormData();
      const buf = Buffer.from(payload.bodyBase64, 'base64');
      const blob = new Blob([new Uint8Array(buf)], { type: payload.mimeType });
      const ext = payload.mimeType === 'image/png' ? 'png'
        : payload.mimeType === 'image/gif' ? 'gif' : 'mp4';
      form.set('file', blob, `capture-${payload.capturedAt}.${ext}`);
      if (payload.caption) {
        form.set('payload_json', JSON.stringify({ content: payload.caption }));
      }
      const res = await args.fetchImpl(args.webhookUrl, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        throw new Error(`discord webhook ${res.status}: ${await res.text().catch(() => '?')}`);
      }
    },
  };
}

function hashWebhookId(url: string): string {
  // Stable short id derived from the path segment — webhook URLs are
  // /api/webhooks/<id>/<token>; we want the id for routing.
  const m = url.match(/\/webhooks\/(\d+)\//);
  return m && m[1] ? m[1] : `webhook-${Math.abs(hashStr(url))}`;
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** Pushcut (iOS Shortcuts) sink — POST to a Pushcut webhook URL with
 *  attachment URL or base64. Used for iPad / iPhone last-mile delivery. */
export function createPushcutCaptureSink(args: {
  pushcutUrl: string;
  fetchImpl: typeof fetch;
  /** Optional device label for routing within Pushcut. */
  deviceLabel?: string;
}): CapturePushSink {
  return {
    kind: 'pushcut',
    id: args.deviceLabel ?? 'default',
    async send(payload) {
      const body = {
        title: payload.caption ?? `elanous capture ${payload.surfaceLabel ?? ''}`.trim(),
        // Pushcut accepts base64 attachments via `image` URL data scheme.
        image: `data:${payload.mimeType};base64,${payload.bodyBase64}`,
      };
      const res = await args.fetchImpl(args.pushcutUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`pushcut ${res.status}`);
      }
    },
  };
}
