import { describe, expect, spyOn, test } from 'bun:test';
import { debug } from '../src/debug/log.js';
import { TelegramBot } from '../src/telegram.js';
import { resetUserConfig, setUserConfigOverlay } from '../src/user-config.js';
import {
  detectDevRequest,
  observeDevRequestRoute,
  observeDevRequestRouteFailSoft,
  type DevRequestRoutingConfig,
} from '../src/skills/dev-request-router.js';

type DebugEvent = {
  category: string;
  event: string;
  data?: Record<string, unknown>;
};

const enabledConfig: DevRequestRoutingConfig = {
  enabled: true,
  verbs: ['implement'],
  guardKeywords: ['explain'],
};

function recordObservation(
  text: string,
  cfg: DevRequestRoutingConfig,
  surface: string,
): { decision: ReturnType<typeof observeDevRequestRoute>; events: DebugEvent[] } {
  const events: DebugEvent[] = [];
  const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
    events.push({ category, event, data });
  }) as never);
  try {
    return {
      decision: observeDevRequestRoute(text, cfg, undefined, { surface }),
      events,
    };
  } finally {
    log.mockRestore();
  }
}

async function runTelegramFreeTextTurn(onMessage: () => Promise<string | void>): Promise<void> {
  let served = false;
  let bot: TelegramBot;
  const fetchImpl = (async (url: string) => {
    if (url.endsWith('/getUpdates')) {
      if (!served) {
        served = true;
        return { json: async () => ({ ok: true, result: [{
          update_id: 1,
          message: {
            message_id: 1,
            from: { id: 42 },
            chat: { id: 42, type: 'private' },
            text: 'implement router telemetry',
          },
        }] }) };
      }
      bot.stop();
      return { json: async () => ({ ok: true, result: [] }) };
    }
    if (url.endsWith('/sendMessage')) {
      return { json: async () => ({ ok: true, result: { message_id: 2 } }) };
    }
    return { json: async () => ({ ok: true, result: {} }) };
  }) as typeof fetch;
  bot = new TelegramBot({
    token: '1:test',
    allowedUsers: [42],
    onMessage: async () => onMessage(),
    fetchImpl,
    errorBackoffMs: 0,
    pollTimeoutSec: 0,
    perChatGapMs: 0,
    streamEditGapMs: 0,
  });
  await bot.start();
}

describe('development-request routing observation wiring', () => {
  test('records a detected decision as would-route without routing it', () => {
    const { decision, events } = recordObservation('implement router telemetry', enabledConfig, 'telegram');

    expect(decision).toEqual(detectDevRequest('implement router telemetry', enabledConfig));
    expect(events).toEqual([{
      category: 'skills.dev-route',
      event: 'would-route',
      data: expect.objectContaining({
        surface: 'telegram',
        decision: true,
        configEnabled: true,
        routed: false,
        routingAction: 'none',
      }),
    }]);
  });

  test('records disabled configuration as an observed non-routing denominator event', () => {
    const { decision, events } = recordObservation('implement router telemetry', { ...enabledConfig, enabled: false }, 'dashboard');

    expect(decision).toBeNull();
    expect(events).toEqual([{
      category: 'skills.dev-route',
      event: 'not-routed',
      data: expect.objectContaining({
        surface: 'dashboard',
        decision: false,
        configEnabled: false,
        routed: false,
        routingAction: 'none',
        reason: 'disabled',
      }),
    }]);
  });

  test('Telegram free-text entry observes a decision and continues to the existing handler', async () => {
    const events: DebugEvent[] = [];
    const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
      if (category === 'skills.dev-route') events.push({ category, event, data });
    }) as never);
    let handlerCalls = 0;
    setUserConfigOverlay((config) => ({
      ...config,
      skills: { ...config.skills, devRequestRouting: enabledConfig },
    }));

    try {
      await runTelegramFreeTextTurn(async () => {
        handlerCalls++;
        return 'normal-chat-path';
      });
      expect(events).toEqual([expect.objectContaining({
        category: 'skills.dev-route',
        event: 'would-route',
        data: expect.objectContaining({
          surface: 'telegram',
          decision: true,
          configEnabled: true,
          routed: false,
          routingAction: 'none',
        }),
      })]);
      expect(handlerCalls).toBe(1);
    } finally {
      log.mockRestore();
      setUserConfigOverlay(null);
      resetUserConfig();
    }
  });

  test('Telegram free-text entry records disabled routing and continues to the existing handler', async () => {
    const events: DebugEvent[] = [];
    const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
      if (category === 'skills.dev-route') events.push({ category, event, data });
    }) as never);
    let handlerCalls = 0;
    setUserConfigOverlay((config) => ({
      ...config,
      skills: { ...config.skills, devRequestRouting: { ...enabledConfig, enabled: false } },
    }));

    try {
      await runTelegramFreeTextTurn(async () => {
        handlerCalls++;
        return 'normal-chat-path';
      });
      expect(events).toEqual([expect.objectContaining({
        category: 'skills.dev-route',
        event: 'not-routed',
        data: expect.objectContaining({
          surface: 'telegram',
          decision: false,
          configEnabled: false,
          reason: 'disabled',
          routed: false,
          routingAction: 'none',
        }),
      })]);
      expect(handlerCalls).toBe(1);
    } finally {
      log.mockRestore();
      setUserConfigOverlay(null);
      resetUserConfig();
    }
  });

  test('Telegram free-text entry continues to the existing handler when observation and error logging fail', async () => {
    const log = spyOn(debug, 'log').mockImplementation(((category: string) => {
      if (category === 'skills.dev-route') throw new Error('log unavailable');
    }) as never);
    let handlerCalls = 0;
    setUserConfigOverlay((config) => ({
      ...config,
      skills: { ...config.skills, devRequestRouting: enabledConfig },
    }));

    try {
      await runTelegramFreeTextTurn(async () => {
        handlerCalls++;
        return 'normal-chat-path';
      });
      expect(handlerCalls).toBe(1);
    } finally {
      log.mockRestore();
      setUserConfigOverlay(null);
      resetUserConfig();
    }
  });

  test('fail-soft observation preserves the caller path when logging is unavailable', () => {
    const expected = detectDevRequest('implement router telemetry', enabledConfig);
    const log = spyOn(debug, 'log').mockImplementation(() => {
      throw new Error('log unavailable');
    });
    try {
      expect(() => observeDevRequestRouteFailSoft('implement router telemetry', enabledConfig, { surface: 'telegram' })).not.toThrow();
      expect(detectDevRequest('implement router telemetry', enabledConfig)).toEqual(expected);
    } finally {
      log.mockRestore();
    }
  });
});
