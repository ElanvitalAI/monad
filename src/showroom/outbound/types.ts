// W7 Z11.a-1 · OutboundRouter substrate types.
// Cf. ROADMAP-showroom-x-task-fabric §4 Z11 (S12).

export type OutboundChannelName =
  | 'ios-push'
  | 'web-push'
  | 'live-activity'
  | 'watch-card'
  | 'carplay'
  | 'homekit'
  | 'vision-pro';

export const OUTBOUND_CHANNEL_NAMES: readonly OutboundChannelName[] = [
  'ios-push',
  'web-push',
  'live-activity',
  'watch-card',
  'carplay',
  'homekit',
  'vision-pro',
];

export type OutboundUrgency = 'low' | 'normal' | 'high' | 'critical';

export interface OutboundEvent {
  /** Domain event id (e.g. showroom session id, retro card id). */
  id: string;
  /** Source surface — for telemetry attribution. */
  source: 'showroom' | 'workflow_runtime' | 'task_orchestrator' | 'thinker' | 'patcher';
  urgency: OutboundUrgency;
  /** Headline string the channel renders verbatim. */
  title: string;
  /** Optional body / longer rendering. */
  body?: string;
  /** Deep-link target the user can tap into. */
  link?: string;
  /** Per-channel hint payload. Channels ignore unknown keys. */
  payload?: Record<string, unknown>;
  /** UTC timestamp ms epoch when the event was created. */
  ts: number;
}

export type ChannelSendResult =
  | { ok: true; channelMessageId?: string }
  | { ok: false; reason: string };

export interface OutboundChannel {
  name: OutboundChannelName;
  /** True when the channel has at least one registered receiver
   *  (e.g. APNs device token, ActivityKit token). Router skips
   *  unavailable channels silently. */
  available(): boolean;
  send(event: OutboundEvent): Promise<ChannelSendResult>;
}
