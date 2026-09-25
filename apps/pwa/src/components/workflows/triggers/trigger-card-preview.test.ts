// Surface-unification ROADMAP §B8 (2026-05-11) — trigger card preview tests.

import { describe, expect, it } from 'bun:test';
import {
  previewScheduleTrigger,
  previewWebhookTrigger,
  previewHttpRequest,
  previewDiscordTrigger,
  previewTelegramTrigger,
  previewManualTrigger,
  previewChatTrigger,
  previewTriggerCard,
} from './trigger-card-preview';

describe('previewScheduleTrigger', () => {
  it('renders daily-at cron with timezone + max_runs', () => {
    expect(
      previewScheduleTrigger({ type: 'cron', cron: '0 9 * * *', timezone: 'Asia/Seoul', max_runs: 30 }),
    ).toBe('⏰ Every day at 09:00 Asia/Seoul · max 30 runs');
  });

  it('marks disabled schedules', () => {
    expect(previewScheduleTrigger({ type: 'cron', cron: '0 9 * * *', enabled: false })).toContain('disabled');
  });

  it('summarizes hourly interval in hours', () => {
    expect(previewScheduleTrigger({ type: 'interval', interval: 3_600_000 })).toBe('⏰ Every 1 hour');
    expect(previewScheduleTrigger({ type: 'interval', interval: 7_200_000 })).toBe('⏰ Every 2 hours');
  });

  it('summarizes 5-minute interval in minutes', () => {
    expect(previewScheduleTrigger({ type: 'interval', interval: 300_000 })).toBe('⏰ Every 5 minutes');
  });

  it('falls back to seconds for sub-minute intervals', () => {
    expect(previewScheduleTrigger({ type: 'interval', interval: 10_000 })).toBe('⏰ Every 10s');
  });
});

describe('previewWebhookTrigger', () => {
  it('renders method · path · auth', () => {
    expect(
      previewWebhookTrigger({ method: 'POST', path: '/hooks/deploy', auth: { type: 'bearer', token: 't' } }),
    ).toBe('🔗 POST /hooks/deploy · bearer');
  });

  it('omits auth when none', () => {
    expect(previewWebhookTrigger({ method: 'GET', path: '/hooks/ping' })).toBe('🔗 GET /hooks/ping');
  });
});

describe('previewHttpRequest', () => {
  it('renders method · url · timeout', () => {
    expect(previewHttpRequest({ method: 'GET', url: 'https://api.example.com', timeout: 30000 })).toBe(
      '🌐 GET https://api.example.com · 30s',
    );
  });

  it('truncates long URLs', () => {
    const long = 'https://api.example.com/' + 'x'.repeat(80);
    const out = previewHttpRequest({ method: 'POST', url: long });
    expect(out.length).toBeLessThanOrEqual(60);
  });
});

describe('previewDiscordTrigger', () => {
  it('renders channel + pattern + kind', () => {
    expect(
      previewDiscordTrigger({ kind: 'message', channel: 'ops', pattern: '^deploy' }),
    ).toBe('💬 #ops · /^deploy/ · message');
  });

  it('falls back to kind only when no filters', () => {
    expect(previewDiscordTrigger({ kind: 'reaction' })).toBe('💬 reaction');
  });
});

describe('previewTelegramTrigger', () => {
  it('renders chat + command for kind=command', () => {
    expect(
      previewTelegramTrigger({ kind: 'command', chat: 'my_group', command: 'summary' }),
    ).toBe('✈️ @my_group · /summary · command');
  });

  it('renders pattern for kind=message', () => {
    expect(previewTelegramTrigger({ kind: 'message', pattern: '^배포' })).toBe('✈️ /^배포/ · message');
  });
});

describe('previewManualTrigger', () => {
  it('renders description when present', () => {
    expect(previewManualTrigger({ description: 'Build then deploy' })).toBe('▶ Build then deploy');
  });

  it('falls back to default copy', () => {
    expect(previewManualTrigger({})).toBe('▶ Manual · explicit run');
    expect(previewManualTrigger(undefined)).toBe('▶ Manual · explicit run');
  });
});

describe('previewChatTrigger', () => {
  it('renders path · session · streaming flags', () => {
    expect(
      previewChatTrigger({ path: '/chat', sessionMode: 'per-session', streaming: true }),
    ).toBe('💭 Chat: /chat · per-session · streaming');
  });

  it('omits flags at defaults', () => {
    expect(previewChatTrigger({ path: '/chat' })).toBe('💭 Chat: /chat');
  });
});

describe('previewTriggerCard dispatcher', () => {
  it('returns null for non-trigger variants', () => {
    expect(previewTriggerCard('bash', { bash: 'echo hi' })).toBeNull();
    expect(previewTriggerCard('prompt', { prompt: 'describe...' })).toBeNull();
  });

  it('dispatches each trigger variant', () => {
    expect(
      previewTriggerCard('scheduleTrigger', { scheduleTrigger: { type: 'cron', cron: '0 9 * * *' } }),
    ).toContain('Every day at 09:00');
    expect(previewTriggerCard('webhookTrigger', { webhookTrigger: { method: 'POST', path: '/h' } })).toContain('POST /h');
    expect(previewTriggerCard('http', { http: { method: 'GET', url: 'https://x.com' } })).toContain('🌐');
    expect(previewTriggerCard('discordTrigger', { discordTrigger: { kind: 'message' } })).toContain('💬');
    expect(previewTriggerCard('telegramTrigger', { telegramTrigger: { kind: 'message' } })).toContain('✈️');
    expect(previewTriggerCard('manualTrigger', { manualTrigger: {} })).toContain('▶');
    expect(previewTriggerCard('chatTrigger', { chatTrigger: { path: '/chat' } })).toContain('💭');
  });
});
