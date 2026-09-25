import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import {
  botCommandCatalog,
  botCommandDeclarations,
  botCommandsToTelegram,
  createBotCommandDeclarationsForTest,
  resolveBotCommandRequest,
  type BotCommandDeclaration,
} from './command-surface.js';
import { botCommandsToDiscord } from '../discord/slash-commands/bots.js';
import { debug } from '../debug/log.js';

type Event = { category: string; event: string; data?: Record<string, unknown> };

const declaration = (handler: BotCommandDeclaration['handler']): BotCommandDeclaration => ({
  name: 'probe', description: 'Probe command',
  arguments: [{ name: 'said', description: 'User text', required: true }],
  handler,
});

const events: Event[] = [];

beforeEach(() => {
  events.length = 0;
  spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
    events.push({ category, event, ...(data === undefined ? {} : { data }) });
  }) as never);
});
afterEach(() => mock.restore());

function commandEvents(): Event[] {
  return events.filter((entry) => entry.category === 'bots.command');
}

describe('bot command request resolution', () => {
  test('rejects an undeclared command', () => {
    expect(resolveBotCommandRequest({ name: 'missing', args: [] })).toMatchObject({
      ok: false,
      reason: 'unknown-command',
    });
  });

  test('rejects botsay unless irreversible access is explicitly allowed', () => {
    expect(resolveBotCommandRequest({ name: 'botsay', args: [] })).toMatchObject({
      ok: false,
      reason: 'irreversible-command',
    });
  });

  test('rejects the --shot argument unless irreversible access is explicitly allowed', () => {
    expect(resolveBotCommandRequest({ name: 'screen', args: ['newsbot', '--shot'] })).toMatchObject({
      ok: false,
      reason: 'irreversible-argument',
    });
  });

  test('allows irreversible commands and arguments only with explicit access', () => {
    expect(resolveBotCommandRequest({ name: 'botsay', args: [], allowIrreversible: true })).toMatchObject({
      ok: true,
      command: { name: 'botsay' },
    });
    expect(resolveBotCommandRequest({
      name: 'screen', args: ['newsbot', '--shot'], allowIrreversible: true,
    })).toMatchObject({
      ok: true,
      command: { name: 'screen' },
    });
  });

  test('redacts user argument content from blocked request detail', () => {
    const result = resolveBotCommandRequest({ name: 'screen', args: ['비밀값zzz', '--shot'] });
    expect(result).toMatchObject({ ok: false, reason: 'irreversible-argument' });
    if (!result.ok) expect(result.detail).not.toContain('비밀값zzz');
  });
});

describe('botsay resident session persistence', () => {
  const personas = [
    { personaId: 'sage', displayName: 'Sage' },
    { personaId: 'pragmatist', displayName: 'Pragmatist' },
  ] as never;

  function botsayHarness(opts: {
    readonly failPersistence?: boolean;
    readonly sent?: Array<Record<string, unknown>>;
    readonly sessions?: Array<{ id: string; personaId: string }>;
    readonly messages?: Array<{ sessionId: string; content: string }>;
  } = {}) {
    const sent = opts.sent ?? [];
    const sessions = opts.sessions ?? [];
    const messages = opts.messages ?? [];
    const declarations = createBotCommandDeclarationsForTest(
      async () => personas,
      { send: (message: Record<string, unknown>) => { sent.push(message); return { id: `receipt-${sent.length}` }; } } as never,
      undefined, undefined, undefined, async () => '', undefined, undefined, undefined, undefined,
      (personaId) => {
        const existing = sessions.find((session) => session.personaId === personaId);
        if (existing) return existing as never;
        const session = { id: `session-${sessions.length + 1}`, personaId };
        sessions.push(session);
        return session as never;
      },
      ((sessionId: string, message: { content: string }) => {
        if (opts.failPersistence) throw new Error('disk unavailable');
        messages.push({ sessionId, content: message.content });
        return { id: sessionId };
      }) as never,
    );
    return { botsay: declarations.find((command) => command.name === 'botsay')!, sent, sessions, messages };
  }

  test('records repeated messages for one bot in its one resident session while preserving mailbox delivery', async () => {
    const { botsay, sent, sessions, messages } = botsayHarness();
    await expect(botsay.handler(['sage', 'first message'])).resolves.toContain('확인 id: receipt-1');
    await expect(botsay.handler(['sage', 'second message'])).resolves.toContain('확인 id: receipt-2');

    expect(sent).toEqual([
      { team: 'botlab', to: 'sage', from: 'user', body: 'first message' },
      { team: 'botlab', to: 'sage', from: 'user', body: 'second message' },
    ]);
    expect(sessions).toEqual([{ id: 'session-1', personaId: 'sage' }]);
    expect(messages).toEqual([
      { sessionId: 'session-1', content: 'first message' },
      { sessionId: 'session-1', content: 'second message' },
    ]);
  });

  test('uses distinct persona-tagged resident sessions for different bots', async () => {
    const { botsay, sessions, messages } = botsayHarness();
    await botsay.handler(['sage', 'hello sage']);
    await botsay.handler(['pragmatist', 'hello pragmatist']);

    expect(sessions).toEqual([
      { id: 'session-1', personaId: 'sage' },
      { id: 'session-2', personaId: 'pragmatist' },
    ]);
    expect(messages).toEqual([
      { sessionId: 'session-1', content: 'hello sage' },
      { sessionId: 'session-2', content: 'hello pragmatist' },
    ]);
  });

  test('keeps mailbox delivery successful and reports a resident-session persistence failure', async () => {
    const { botsay, sent, sessions } = botsayHarness({ failPersistence: true });

    await expect(botsay.handler(['sage', 'keep delivery'])).resolves.toContain('⚠️ 상주 대화 기록 실패: disk unavailable');
    expect(sent).toEqual([{ team: 'botlab', to: 'sage', from: 'user', body: 'keep delivery' }]);
    expect(sessions).toEqual([{ id: 'session-1', personaId: 'sage' }]);
  });

  test('does not create a resident session for an unknown bot', async () => {
    const { botsay, sent, sessions, messages } = botsayHarness();

    await expect(botsay.handler(['missing', 'message'])).resolves.toContain("봇 'missing'을 찾을 수 없습니다");
    expect(sent).toEqual([]);
    expect(sessions).toEqual([]);
    expect(messages).toEqual([]);
  });
});

describe('surface-neutral bot command dispatch', () => {
  test('derives a catalog with the same number of commands as the declarations', () => {
    expect(botCommandCatalog()).toHaveLength(botCommandDeclarations.length);
  });

  test('uses provided declarations instead of the default catalog source', () => {
    expect(botCommandCatalog([declaration(async () => 'ok')])).toEqual([{
      name: 'probe',
      description: 'Probe command',
      arguments: [{ name: 'said', description: 'User text', required: true }],
    }]);
  });

  test('excludes handlers and every non-catalog key from entries and arguments', () => {
    for (const entry of botCommandCatalog()) {
      expect(Object.keys(entry).sort()).toEqual(['arguments', 'description', 'name']);
      for (const argument of entry.arguments) {
        expect(Object.keys(argument).sort()).toEqual(['description', 'name', 'required']);
      }
    }
  });

  test('round-trips the catalog through JSON without data loss', () => {
    const catalog = botCommandCatalog();
    expect(JSON.parse(JSON.stringify(catalog))).toEqual(catalog);
  });

  test('records Telegram enter and exit with its image capability', async () => {
    const telegram = botCommandsToTelegram([declaration(async () => 'ok')])[0]!;
    await expect(telegram.handler(['private-telegram-argument'], {} as never, {
      fileSink: { sendImage: () => {} },
    } as never)).resolves.toBe('ok');

    const [enter, exit] = commandEvents();
    expect(enter).toMatchObject({ event: 'dispatch-enter', data: {
      name: 'probe', argCount: 1, hasOpts: true, canSendImage: true, surface: 'telegram',
    } });
    expect(exit).toMatchObject({ event: 'dispatch-exit', data: {
      name: 'probe', replyChars: 2, surface: 'telegram',
    } });
  });

  test('records Discord enter and exit without inventing an image capability', async () => {
    const discord = botCommandsToDiscord([declaration(async (args) => `ok:${args[0]}`)])[0]!;
    const response = await discord.handler({
      options: new Map([['said', 'private-discord-argument']]),
    } as never, {} as never);

    expect(response).toEqual({ type: 4, content: 'ok:private-discord-argument', ephemeral: true });
    const [enter, exit] = commandEvents();
    expect(enter).toMatchObject({ event: 'dispatch-enter', data: {
      name: 'probe', argCount: 1, hasOpts: false, surface: 'discord',
    } });
    expect(enter!.data).not.toHaveProperty('canSendImage');
    expect(exit).toMatchObject({ event: 'dispatch-exit', data: {
      name: 'probe', replyChars: 'ok:private-discord-argument'.length, surface: 'discord',
    } });
  });

  test.each(['telegram', 'discord'] as const)('%s adapter logs throw metadata, omits secrets, and rethrows', async (surface) => {
    const secretArgument = 'private-argument-771';
    const secretMessage = 'private-error-message-772';
    const command = declaration(async () => { throw new TypeError(secretMessage); });

    if (surface === 'telegram') {
      const telegram = botCommandsToTelegram([command])[0]!;
      await expect(telegram.handler([secretArgument], {} as never, {} as never)).rejects.toThrow(secretMessage);
    } else {
      const discord = botCommandsToDiscord([command])[0]!;
      await expect(discord.handler({
        options: new Map([['said', secretArgument]]),
      } as never, {} as never)).rejects.toThrow(secretMessage);
    }

    const serialized = JSON.stringify(commandEvents());
    expect(serialized).not.toContain(secretArgument);
    expect(serialized).not.toContain(secretMessage);
    expect(commandEvents().at(-1)).toMatchObject({ event: 'dispatch-threw', data: {
      name: 'probe', errorName: 'TypeError', whyChars: secretMessage.length, surface,
    } });
  });
});
