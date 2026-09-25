// Test: src/discord/slash-commands/* — handler purity + parse paths.

import { describe, expect, test } from 'bun:test';
import { personaCommand, type PersonaCtx } from '../../src/discord/slash-commands/persona.js';
import { pollCommand, type PollCtx } from '../../src/discord/slash-commands/poll.js';
import { relayCommand, type RelayCtx } from '../../src/discord/slash-commands/relay.js';
import { showroomCommand, type ShowroomCtx } from '../../src/discord/slash-commands/showroom.js';
import { statusCommand, type StatusCtx } from '../../src/discord/slash-commands/status.js';
import type { SlashInteraction } from '../../src/discord/slash-types.js';
import type { PersonaProfile } from '../../src/persona/types.js';

function intr(commandName: string, options: Record<string, string | number | boolean> = {}): SlashInteraction {
  const m = new Map<string, string | number | boolean>();
  for (const [k, v] of Object.entries(options)) m.set(k, v);
  return {
    id: 'i-1', token: 't', applicationId: 'a',
    commandName, channelId: 'ch-1', userId: 'u-1', options: m,
  };
}

const SAGE: PersonaProfile = Object.freeze({
  personaId: 'sage', displayName: 'Sage',
  description: '신중한', brand: 'claude',
  models: { primary: 'claude-opus-4-7' },
});

describe('/showroom handler', () => {
  test('parses lanes and acks (dry-run)', async () => {
    const ctx: ShowroomCtx = {};
    const r = await showroomCommand.handler(
      intr('showroom', { lanes: 'plan:claude build:codex review:gemini' }),
      ctx,
    );
    expect(r.content).toContain('Would spawn 3 lane');
    expect(r.ephemeral).toBe(true);
  });

  test('missing lanes → ⚠️', async () => {
    const r = await showroomCommand.handler(intr('showroom', { lanes: '' }), {});
    expect(r.content).toMatch(/required/);
    expect(r.ephemeral).toBe(true);
  });

  test('lane parse error surfaces', async () => {
    const r = await showroomCommand.handler(
      intr('showroom', { lanes: 'auto:bogus' }), {},
    );
    expect(r.content).toMatch(/role must be one of/);
  });

  test('auto_relay choice + spawnLanes callback wired', async () => {
    let captured: any = null;
    const ctx: ShowroomCtx = {
      spawnLanes: async (req) => { captured = req; return { message: 'spawned' }; },
    };
    const r = await showroomCommand.handler(
      intr('showroom', { lanes: 'plan:claude', auto_relay: 'on' }), ctx,
    );
    expect(captured.tokens).toEqual(['plan:claude']);
    expect(captured.autoRelay).toBe(true);
    expect(r.content).toBe('spawned');
  });
});

describe('/persona handler', () => {
  function ctxWith(personas: PersonaProfile[]): PersonaCtx {
    const map = new Map<string, PersonaProfile>();
    for (const p of personas) map.set(p.personaId, p);
    return {
      listPersonas: () => personas,
      getPersona: (id) => map.get(id),
    };
  }

  test('list — empty', async () => {
    const r = await personaCommand.handler(intr('persona', { action: 'list' }), ctxWith([]));
    expect(r.content).toMatch(/no personas/);
  });

  test('list — populated returns embeds', async () => {
    const r = await personaCommand.handler(intr('persona', { action: 'list' }), ctxWith([SAGE]));
    expect(r.embeds).toBeDefined();
    expect(r.embeds!.length).toBe(1);
    expect((r.embeds![0] as any).title).toBe('Sage');
  });

  test('use — missing persona_id', async () => {
    const r = await personaCommand.handler(intr('persona', { action: 'use' }), ctxWith([SAGE]));
    expect(r.content).toMatch(/persona_id.*required/);
  });

  test('use — unknown persona', async () => {
    const r = await personaCommand.handler(
      intr('persona', { action: 'use', persona_id: 'nope' }), ctxWith([SAGE]),
    );
    expect(r.content).toMatch(/not found/);
  });

  test('use — known persona invokes setActivePersona', async () => {
    const invoked: { ch?: string; pid?: string } = {};
    const ctx: PersonaCtx = {
      listPersonas: () => [SAGE], getPersona: (id) => id === 'sage' ? SAGE : undefined,
      setActivePersona: async (ch, pid) => { invoked.ch = ch; invoked.pid = pid; },
    };
    const r = await personaCommand.handler(
      intr('persona', { action: 'use', persona_id: 'sage' }), ctx,
    );
    expect(invoked.ch).toBe('ch-1');
    expect(invoked.pid).toBe('sage');
    expect(r.content).toMatch(/active persona set to/);
  });

  test('unknown action', async () => {
    const r = await personaCommand.handler(
      intr('persona', { action: 'reset' }), ctxWith([SAGE]),
    );
    expect(r.content).toMatch(/unknown action/);
  });
});

describe('/relay handler', () => {
  test('mention-only sets channel strategy', async () => {
    const invoked: { ch?: string; s?: string } = {};
    const ctx: RelayCtx = {
      setChannelStrategy: async (ch, s) => { invoked.ch = ch; invoked.s = s; },
    };
    const r = await relayCommand.handler(
      intr('relay', { strategy: 'mention-only' }), ctx,
    );
    expect(invoked.ch).toBe('ch-1');
    expect(invoked.s).toBe('mention-only');
    expect(r.content).toMatch(/strategy set to/);
  });

  test('round-robin not yet wired in sprint 21', async () => {
    const r = await relayCommand.handler(
      intr('relay', { strategy: 'round-robin' }), {},
    );
    expect(r.content).toMatch(/not yet wired/);
  });

  test('invalid strategy', async () => {
    const r = await relayCommand.handler(
      intr('relay', { strategy: 'random' }), {},
    );
    expect(r.content).toMatch(/strategy must be one of/);
  });
});

describe('/status handler', () => {
  test('emits formatted snapshot', async () => {
    const ctx: StatusCtx = {
      snapshot: () => ({
        uptimeSeconds: 3725,
        personaCount: 3,
        activeLaneCount: 2,
        version: '1.2.3',
      }),
    };
    const r = await statusCommand.handler(intr('status'), ctx);
    expect(r.content).toContain('uptime');
    expect(r.content).toContain('1h 02m');
    expect(r.content).toContain('personas** 3');
    expect(r.content).toContain('lanes** 2');
    expect(r.content).toContain('1.2.3');
    expect(r.ephemeral).toBe(true);
  });

  test('cost summary optional', async () => {
    const r = await statusCommand.handler(intr('status'), {
      snapshot: () => ({
        uptimeSeconds: 60, personaCount: 0, activeLaneCount: 0,
        costSummary: { monthSpendUsd: 0.0142, monthBudgetUsd: 5 },
      }),
    });
    expect(r.content).toContain('cost (mtd)');
    expect(r.content).toContain('$0.0142');
    expect(r.content).toContain('$5.00');
  });
});

describe('/poll handler', () => {
  test('builds dry-run when postPoll unwired', async () => {
    const r = await pollCommand.handler(
      intr('poll', {
        question: '이 안 채택?',
        answers: 'A | B | C',
      }), {},
    );
    expect(r.content).toMatch(/dry-run/);
    expect(r.content).toContain('3 answer');
  });

  test('posts via postPoll callback', async () => {
    let captured: any = null;
    const ctx: PollCtx = {
      postPoll: async (ch, body) => { captured = { ch, body }; return { messageId: 'm-9' }; },
    };
    const r = await pollCommand.handler(
      intr('poll', {
        question: '진행?', answers: 'yes | no', duration_hours: 12,
      }), ctx,
    );
    expect(captured.ch).toBe('ch-1');
    expect((captured.body as any).question).toEqual({ text: '진행?' });
    expect(((captured.body as any).answers as any[]).length).toBe(2);
    expect((captured.body as any).duration).toBe(12);
    expect(r.content).toContain('m-9');
  });

  test('< 2 answers → ⚠️', async () => {
    const r = await pollCommand.handler(
      intr('poll', { question: 'hi', answers: 'only' }), {},
    );
    expect(r.content).toMatch(/at least 2 answers/);
  });

  test('postPoll throw → error ack', async () => {
    const ctx: PollCtx = {
      postPoll: async () => { throw new Error('rate limited'); },
    };
    const r = await pollCommand.handler(
      intr('poll', { question: 'h', answers: 'a | b' }), ctx,
    );
    expect(r.content).toMatch(/post failed/);
    expect(r.content).toContain('rate limited');
  });
});
