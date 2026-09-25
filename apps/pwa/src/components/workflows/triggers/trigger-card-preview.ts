// Surface-unification ROADMAP §B8 (2026-05-11) — human-readable card
// previews for the trigger variants. The graph card already renders a
// compact "preview" string under the variant label; this helper makes
// the trigger variants speak in user-facing English ("Every day at 09:00",
// "💬 #ops · /^배포/") instead of raw cron / regex.
//
// Pure helper · unit-test driven. No React imports.

import { previewCron } from './cron-preview';

type AnyObj = Record<string, unknown>;

function s(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export function previewScheduleTrigger(payload: AnyObj | undefined): string {
  if (!payload) return '⏰ schedule';
  const type = payload['type'];
  if (type === 'cron') {
    const cron = s(payload['cron']);
    const tz = s(payload['timezone']);
    const desc = previewCron(cron);
    const enabled = payload['enabled'] === false ? ' · disabled' : '';
    const maxRuns = typeof payload['max_runs'] === 'number' ? ` · max ${payload['max_runs']} runs` : '';
    const tzSuffix = tz ? ` ${tz}` : '';
    return `⏰ ${desc.text}${tzSuffix}${maxRuns}${enabled}`;
  }
  if (type === 'interval') {
    const ms = typeof payload['interval'] === 'number' ? (payload['interval'] as number) : 0;
    const enabled = payload['enabled'] === false ? ' · disabled' : '';
    if (ms >= 3_600_000 && ms % 3_600_000 === 0) {
      const h = ms / 3_600_000;
      return `⏰ Every ${h} hour${h === 1 ? '' : 's'}${enabled}`;
    }
    if (ms >= 60_000 && ms % 60_000 === 0) {
      const m = ms / 60_000;
      return `⏰ Every ${m} minute${m === 1 ? '' : 's'}${enabled}`;
    }
    const sec = Math.max(1, Math.round(ms / 1000));
    return `⏰ Every ${sec}s${enabled}`;
  }
  return '⏰ schedule';
}

export function previewWebhookTrigger(payload: AnyObj | undefined): string {
  if (!payload) return '🔗 webhook';
  const method = s(payload['method'], 'POST');
  const path = s(payload['path']);
  const a = payload['auth'] && typeof payload['auth'] === 'object' ? (payload['auth'] as AnyObj) : null;
  const auth = a ? ` · ${s(a['type'])}` : '';
  return `🔗 ${method} ${path}${auth}`;
}

export function previewHttpRequest(payload: AnyObj | undefined): string {
  if (!payload) return '🌐 http';
  const method = s(payload['method'], 'GET');
  const url = s(payload['url']);
  const timeout = typeof payload['timeout'] === 'number' ? ` · ${Math.round((payload['timeout'] as number) / 1000)}s` : '';
  return `🌐 ${method} ${url.slice(0, 48)}${timeout}`;
}

export function previewDiscordTrigger(payload: AnyObj | undefined): string {
  if (!payload) return '💬 discord';
  const kind = s(payload['kind'], 'message');
  const parts: string[] = [];
  const channel = s(payload['channel']);
  if (channel) parts.push(`#${channel}`);
  if (s(payload['user'])) parts.push(`@${s(payload['user'])}`);
  if (s(payload['pattern'])) parts.push(`/${s(payload['pattern'])}/`);
  parts.push(kind);
  return `💬 ${parts.join(' · ')}`;
}

export function previewTelegramTrigger(payload: AnyObj | undefined): string {
  if (!payload) return '✈️ telegram';
  const kind = s(payload['kind'], 'message');
  const parts: string[] = [];
  if (s(payload['chat'])) parts.push(`@${s(payload['chat'])}`);
  if (kind === 'command' && s(payload['command'])) parts.push(`/${s(payload['command'])}`);
  if (s(payload['user'])) parts.push(`from:${s(payload['user'])}`);
  if (s(payload['pattern'])) parts.push(`/${s(payload['pattern'])}/`);
  parts.push(kind);
  return `✈️ ${parts.join(' · ')}`;
}

export function previewManualTrigger(payload: AnyObj | undefined): string {
  const desc = s(payload?.['description']);
  return desc ? `▶ ${desc}` : '▶ Manual · explicit run';
}

export function previewChatTrigger(payload: AnyObj | undefined): string {
  if (!payload) return '💭 Chat';
  const path = s(payload['path'], '/chat');
  const session = payload['sessionMode'] === 'per-session' ? ' · per-session' : '';
  const streaming = payload['streaming'] === true ? ' · streaming' : '';
  return `💭 Chat: ${path}${session}${streaming}`;
}

/** Dispatch by node-variant key. Returns null for non-trigger variants
 *  so the existing per-variant switch in workflow-graph-layout.ts can
 *  fall through to its original behavior. */
export function previewTriggerCard(
  variant: string,
  raw: AnyObj,
): string | null {
  switch (variant) {
    case 'scheduleTrigger':
      return previewScheduleTrigger(raw['scheduleTrigger'] as AnyObj | undefined);
    case 'webhookTrigger':
      return previewWebhookTrigger(raw['webhookTrigger'] as AnyObj | undefined);
    case 'http':
      return previewHttpRequest(raw['http'] as AnyObj | undefined);
    case 'discordTrigger':
      return previewDiscordTrigger(raw['discordTrigger'] as AnyObj | undefined);
    case 'telegramTrigger':
      return previewTelegramTrigger(raw['telegramTrigger'] as AnyObj | undefined);
    case 'manualTrigger':
      return previewManualTrigger(raw['manualTrigger'] as AnyObj | undefined);
    case 'chatTrigger':
      return previewChatTrigger(raw['chatTrigger'] as AnyObj | undefined);
    default:
      return null;
  }
}
