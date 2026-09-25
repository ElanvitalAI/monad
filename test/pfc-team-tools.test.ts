// ── PFC-S1 P4: TeamCreate / TeamDelete / SendMessage LLM tool tests ──
//
// Covers:
//   • Tool spec shape (name, description, required fields)
//   • dispatchTeamCreate + dispatchTeamDelete basics
//   • dispatchSendMessage sender resolution (explicit > registry > user)
//   • schema validation (missing to / empty body)
//   • team_name default 'global'
//   • auto-team creation on first SendMessage
//   • reply_to threading
//   • cross-team isolation
//   • subject optional
//   • native-tool-catalog + runtime registration

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildTeamCreateTool,
  buildTeamDeleteTool,
  buildSendMessageTool,
  dispatchTeamCreate,
  dispatchTeamDelete,
  dispatchSendMessage,
} from '../src/agent-team/team-tools';
import { TeamMailbox } from '../src/agent-team/mailbox';
import { AgentRegistry } from '../src/agent/registry';
import type { AgentDefinition } from '../src/agent/types';

let tmp: string;
let mbox: TeamMailbox;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pfc-team-tools-'));
  mbox = new TeamMailbox(tmp);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('Tool specs', () => {
  test('TeamCreate spec has required name', () => {
    const s = buildTeamCreateTool();
    expect(s.name).toBe('TeamCreate');
    const params = s.parameters as any;
    expect(params.required).toEqual(['name']);
  });

  test('TeamDelete spec has required name', () => {
    const s = buildTeamDeleteTool();
    expect(s.name).toBe('TeamDelete');
    const params = s.parameters as any;
    expect(params.required).toEqual(['name']);
  });

  test('SendMessage spec has required to + body', () => {
    const s = buildSendMessageTool();
    expect(s.name).toBe('SendMessage');
    const params = s.parameters as any;
    expect(params.required).toEqual(['to', 'body']);
    expect(params.properties).toHaveProperty('team_name');
    expect(params.properties).toHaveProperty('reply_to');
    expect(params.properties).toHaveProperty('subject');
  });
});

describe('dispatchTeamCreate', () => {
  test('creates a team + returns roster', () => {
    const r = dispatchTeamCreate(
      { name: 'alpha', members: ['explore', 'plan'] },
      { mailbox: mbox },
    );
    expect(r.team).toBe('alpha');
    expect(r.roster.members).toEqual(['explore', 'plan']);
    expect(r.output).toContain('alpha');
  });

  test('idempotent — re-create with new members merges', () => {
    dispatchTeamCreate({ name: 'alpha', members: ['a'] }, { mailbox: mbox });
    const r = dispatchTeamCreate({ name: 'alpha', members: ['b'] }, { mailbox: mbox });
    expect(r.roster.members.sort()).toEqual(['a', 'b']);
  });

  test('rejects bad team name', () => {
    expect(() =>
      dispatchTeamCreate({ name: '../escape' }, { mailbox: mbox }),
    ).toThrow(/invalid/);
  });
});

describe('dispatchTeamDelete', () => {
  test('existing team → deleted:true', () => {
    dispatchTeamCreate({ name: 'beta' }, { mailbox: mbox });
    const r = dispatchTeamDelete({ name: 'beta' }, { mailbox: mbox });
    expect(r.deleted).toBe(true);
  });

  test('missing team → deleted:false', () => {
    const r = dispatchTeamDelete({ name: 'ghost' }, { mailbox: mbox });
    expect(r.deleted).toBe(false);
  });
});

describe('dispatchSendMessage', () => {
  test('sender falls back to "user" when no context', () => {
    const r = dispatchSendMessage(
      { to: 'plan', body: 'hello' },
      { mailbox: mbox },
    );
    expect(r.message.from).toBe('user');
    expect(r.message.to).toBe('plan');
    expect(r.message.team).toBe('global'); // DEFAULT_TEAM
  });

  test('explicit senderAgent wins', () => {
    const r = dispatchSendMessage(
      { to: 'plan', body: 'hello' },
      { mailbox: mbox, senderAgent: 'explore' },
    );
    expect(r.message.from).toBe('explore');
  });

  test('registry lookup via parentCorrelationId', () => {
    const reg = new AgentRegistry();
    const def: AgentDefinition = { name: 'critic', systemPrompt: 'x' };
    const task = reg.register(def, 'ambient-prompt');
    task.correlationId = 'cid-xyz';
    const r = dispatchSendMessage(
      { to: 'plan', body: 'from critic' },
      { mailbox: mbox, registry: reg, parentCorrelationId: 'cid-xyz' },
    );
    expect(r.message.from).toBe('critic');
  });

  test('explicit senderAgent still beats registry match', () => {
    const reg = new AgentRegistry();
    const def: AgentDefinition = { name: 'critic', systemPrompt: 'x' };
    const task = reg.register(def, 'ambient');
    task.correlationId = 'cid-abc';
    const r = dispatchSendMessage(
      { to: 'plan', body: 'override' },
      {
        mailbox: mbox,
        registry: reg,
        parentCorrelationId: 'cid-abc',
        senderAgent: 'research',
      },
    );
    expect(r.message.from).toBe('research');
  });

  test('custom team_name used when provided', () => {
    const r = dispatchSendMessage(
      { to: 'plan', body: 'x', team_name: 'study' },
      { mailbox: mbox },
    );
    expect(r.message.team).toBe('study');
    // Auto-team creation: study should now exist with empty roster
    expect(mbox.getRoster('study')).not.toBeNull();
    expect(mbox.getRoster('study')?.members).toEqual([]);
  });

  test('subject preserved when provided', () => {
    const r = dispatchSendMessage(
      { to: 'plan', body: 'x', subject: 'finding A' },
      { mailbox: mbox },
    );
    expect(r.message.subject).toBe('finding A');
  });

  test('reply_to threading preserved', () => {
    const first = dispatchSendMessage(
      { to: 'plan', body: 'original' },
      { mailbox: mbox },
    );
    const reply = dispatchSendMessage(
      { to: 'user', body: 'reply', reply_to: first.message.id },
      { mailbox: mbox, senderAgent: 'plan' },
    );
    expect(reply.message.replyTo).toBe(first.message.id);
  });

  test('empty body rejected', () => {
    expect(() =>
      dispatchSendMessage({ to: 'plan', body: '' }, { mailbox: mbox }),
    ).toThrow(/body/);
  });

  test('missing to rejected', () => {
    expect(() =>
      dispatchSendMessage({ body: 'x' }, { mailbox: mbox }),
    ).toThrow(/`to`/);
  });

  test('cross-team isolation — send to two teams, each recipient only sees its own', () => {
    dispatchSendMessage(
      { to: 'plan', body: 'msg-A', team_name: 'alpha' },
      { mailbox: mbox },
    );
    dispatchSendMessage(
      { to: 'plan', body: 'msg-B', team_name: 'beta' },
      { mailbox: mbox },
    );
    expect(mbox.list('alpha', 'plan').map(m => m.body)).toEqual(['msg-A']);
    expect(mbox.list('beta', 'plan').map(m => m.body)).toEqual(['msg-B']);
  });

  test('output contains id + recipient + team', () => {
    const r = dispatchSendMessage(
      { to: 'plan', body: 'hello', team_name: 'ops' },
      { mailbox: mbox },
    );
    expect(r.output).toContain(r.message.id);
    expect(r.output).toContain('plan');
    expect(r.output).toContain('ops');
  });
});
