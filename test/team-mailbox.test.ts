// ── PFC-S1 P3: TeamMailbox JSONL store ──
//
// Covers:
//   • createTeam / deleteTeam idempotency + roster file
//   • listTeams / getRoster
//   • send append → list + unreadOnly + limit
//   • markRead atomic rewrite
//   • cross-team + cross-recipient isolation
//   • malformed JSONL tail tolerance
//   • input sanitization

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TeamMailbox } from '../src/agent-team/mailbox';

let tmp: string;
let mbox: TeamMailbox;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pfc-mbox-'));
  mbox = new TeamMailbox(tmp);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('Team lifecycle', () => {
  test('createTeam writes .roster.json', () => {
    const r = mbox.createTeam('study', ['explore', 'plan']);
    expect(r.name).toBe('study');
    expect(r.members).toEqual(['explore', 'plan']);
    expect(existsSync(join(tmp, 'study', '.roster.json'))).toBe(true);
  });

  test('createTeam idempotent — re-create extends membership', () => {
    mbox.createTeam('study', ['explore']);
    const r = mbox.createTeam('study', ['plan', 'explore']);
    expect(r.members.sort()).toEqual(['explore', 'plan']);
  });

  test('deleteTeam removes directory + returns true', () => {
    mbox.createTeam('study');
    expect(mbox.deleteTeam('study')).toBe(true);
    expect(existsSync(join(tmp, 'study'))).toBe(false);
  });

  test('deleteTeam on missing team returns false', () => {
    expect(mbox.deleteTeam('ghost')).toBe(false);
  });

  test('listTeams empty when root missing', () => {
    rmSync(tmp, { recursive: true, force: true });
    expect(mbox.listTeams()).toEqual([]);
  });

  test('listTeams returns sorted rosters', () => {
    mbox.createTeam('zeta');
    mbox.createTeam('alpha');
    const names = mbox.listTeams().map(r => r.name);
    expect(names).toEqual(['alpha', 'zeta']);
  });

  test('getRoster for missing team is null', () => {
    expect(mbox.getRoster('ghost')).toBeNull();
  });
});

describe('send / list', () => {
  test('send appends a line + returns stamped message', () => {
    mbox.createTeam('study', ['explore', 'plan']);
    const m = mbox.send({
      team: 'study',
      from: 'explore',
      to: 'plan',
      subject: 'finding',
      body: 'there are 3 inputs',
    });
    expect(m.id).toMatch(/^msg-/);
    expect(m.read).toBe(false);
    expect(m.ts).toBeGreaterThan(0);
    // File should be created at <team>/<recipient>.mbox
    const raw = readFileSync(join(tmp, 'study', 'plan.mbox'), 'utf-8');
    expect(raw).toContain('"body":"there are 3 inputs"');
    expect(raw.endsWith('\n')).toBe(true);
  });

  test('list returns messages in send order', () => {
    mbox.send({ team: 'study', from: 'explore', to: 'plan', body: 'a' });
    mbox.send({ team: 'study', from: 'explore', to: 'plan', body: 'b' });
    mbox.send({ team: 'study', from: 'explore', to: 'plan', body: 'c' });
    const got = mbox.list('study', 'plan');
    expect(got.map(m => m.body)).toEqual(['a', 'b', 'c']);
  });

  test('list unreadOnly filters read messages', () => {
    const a = mbox.send({ team: 'study', from: 'x', to: 'y', body: 'a' });
    mbox.send({ team: 'study', from: 'x', to: 'y', body: 'b' });
    mbox.markRead('study', 'y', [a.id]);
    const unread = mbox.list('study', 'y', { unreadOnly: true });
    expect(unread.map(m => m.body)).toEqual(['b']);
  });

  test('list limit keeps the last N', () => {
    for (let i = 0; i < 5; i++) {
      mbox.send({ team: 'study', from: 'x', to: 'y', body: `m${i}` });
    }
    const tail = mbox.list('study', 'y', { limit: 2 });
    expect(tail.map(m => m.body)).toEqual(['m3', 'm4']);
  });

  test('list missing recipient → empty', () => {
    expect(mbox.list('study', 'nobody')).toEqual([]);
  });

  test('replyTo field preserved', () => {
    const a = mbox.send({ team: 'study', from: 'x', to: 'y', body: 'a' });
    const b = mbox.send({
      team: 'study', from: 'y', to: 'x', body: 'reply', replyTo: a.id,
    });
    const got = mbox.list('study', 'x');
    expect(got[0]!.replyTo).toBe(a.id);
    expect(b.replyTo).toBe(a.id);
  });

  test('malformed tail tolerated — returns prefix', () => {
    mbox.send({ team: 'study', from: 'x', to: 'y', body: 'good' });
    // Append garbage to the file.
    writeFileSync(
      join(tmp, 'study', 'y.mbox'),
      '{"id":"bad","ts":unclosed',
      { flag: 'a' },
    );
    const got = mbox.list('study', 'y');
    expect(got.length).toBe(1);
    expect(got[0]!.body).toBe('good');
  });

  test('send rejects empty body', () => {
    expect(() => mbox.send({
      team: 'study', from: 'x', to: 'y', body: '',
    })).toThrow(/body/);
  });
});

describe('markRead', () => {
  test('flips read=true for matching ids', () => {
    const a = mbox.send({ team: 'study', from: 'x', to: 'y', body: 'a' });
    const b = mbox.send({ team: 'study', from: 'x', to: 'y', body: 'b' });
    const flipped = mbox.markRead('study', 'y', [a.id]);
    expect(flipped).toBe(1);
    const msgs = mbox.list('study', 'y');
    expect(msgs.find(m => m.id === a.id)?.read).toBe(true);
    expect(msgs.find(m => m.id === b.id)?.read).toBe(false);
  });

  test('markRead idempotent — re-mark returns 0', () => {
    const a = mbox.send({ team: 'study', from: 'x', to: 'y', body: 'a' });
    mbox.markRead('study', 'y', [a.id]);
    expect(mbox.markRead('study', 'y', [a.id])).toBe(0);
  });

  test('markRead on missing recipient returns 0', () => {
    expect(mbox.markRead('study', 'nobody', ['msg-nope'])).toBe(0);
  });
});

describe('Isolation', () => {
  test('different recipients see separate message sets', () => {
    mbox.send({ team: 'study', from: 'x', to: 'plan', body: 'for plan' });
    mbox.send({ team: 'study', from: 'x', to: 'critic', body: 'for critic' });
    expect(mbox.list('study', 'plan').map(m => m.body)).toEqual(['for plan']);
    expect(mbox.list('study', 'critic').map(m => m.body)).toEqual(['for critic']);
  });

  test('different teams see separate message sets', () => {
    mbox.send({ team: 'study', from: 'x', to: 'plan', body: 'A msg' });
    mbox.send({ team: 'ops',   from: 'x', to: 'plan', body: 'B msg' });
    expect(mbox.list('study', 'plan').map(m => m.body)).toEqual(['A msg']);
    expect(mbox.list('ops',   'plan').map(m => m.body)).toEqual(['B msg']);
  });
});

describe('Sanitization', () => {
  test('rejects team name with slashes / traversal', () => {
    expect(() => mbox.createTeam('../escape')).toThrow(/invalid/);
    expect(() => mbox.createTeam('team/nested')).toThrow(/invalid/);
  });

  test('rejects leading dash in member name', () => {
    expect(() => mbox.send({ team: 'study', from: '-bad', to: 'y', body: 'x' })).toThrow(/invalid/);
  });

  test('empty team/member rejected', () => {
    expect(() => mbox.createTeam('')).toThrow();
    expect(() => mbox.send({ team: 'study', from: '', to: 'y', body: 'x' })).toThrow();
  });
});

// ⛔⭐ 계측 회귀 방어 — 「봇끼리 대화」는 2026-08-26 에 «통과했는데 관측이 0건»이었다.
//    실측: src/agent-team/ 파일 2개에 debug.log 가 «0개»라, 「봇들이 대화했나」를
//    .mbox 파일을 «열어야만» 알 수 있었다. 그래서 경계 셋에 계측을 넣었고
//    이 절이 그것을 «되돌리면 깨지게» 문다.
describe('계측 — 「봇들이 대화했나」가 관측으로 답해야 한다', () => {
  type Row = { category: string; event: string; data?: Record<string, unknown> };

  // ⛔ 싱크는 «함수»가 아니라 «객체»다({ name, emit }) — 첫 판에 함수로 넘겼다가
  //    시험 넷이 조용히 0행을 받았다. 계약을 추측하지 말고 src/mss/logging/sink.ts 를 보라.
  async function captureRows(run: (mb: TeamMailbox) => void): Promise<Row[]> {
    const { debug } = await import('../src/debug/log');
    const rows: Row[] = [];
    const off = debug.registerSink({
      name: 'mailbox-instrumentation-test',
      emit(rec: { category: string; event: string; data?: unknown }) {
        if (rec.category === 'agent-team.mailbox') rows.push(rec as Row);
      },
    });
    try { run(mbox); } finally { off(); }
    return rows;
  }

  test('보내면 «보낸이·받는이»가 관측에 남는다 — 본문은 «안» 싣는다', async () => {
    mbox.createTeam('botlab', ['investor', 'newsbot']);
    const rows = await captureRows((mb) => {
      mb.send({ team: 'botlab', from: 'investor', to: 'newsbot', body: '외국인 순매수 상위 셋' });
    });
    const sent = rows.filter(r => r.event === 'send');
    expect(sent.length).toBe(1);
    expect(sent[0]?.data?.from).toBe('investor');
    expect(sent[0]?.data?.to).toBe('newsbot');
    expect(sent[0]?.data?.bodyChars).toBe('외국인 순매수 상위 셋'.length);
    // ⛔ 본문이 새면 안 된다 — 관측은 「누가 누구에게」까지다.
    expect(JSON.stringify(sent[0]?.data ?? {})).not.toContain('외국인');
  });

  test('받는 쪽 조회가 «보낸 사람 이름»을 싣는다 — B5 의 판정이 그것이었다', async () => {
    mbox.createTeam('botlab', ['investor', 'newsbot']);
    mbox.send({ team: 'botlab', from: 'investor', to: 'newsbot', body: 'a' });
    const rows = await captureRows((mb) => { mb.list('botlab', 'newsbot'); });
    const listed = rows.filter(r => r.event === 'list');
    expect(listed.length).toBe(1);
    expect(listed[0]?.data?.senders).toEqual(['investor']);
    expect(listed[0]?.data?.returned).toBe(1);
    expect(listed[0]?.data?.unread).toBe(1);
  });

  test('읽음 표시도 남는다 — 「보냈다」와 「읽었다」가 다른 값이다', async () => {
    mbox.createTeam('botlab', ['investor', 'newsbot']);
    const m = mbox.send({ team: 'botlab', from: 'investor', to: 'newsbot', body: 'a' });
    const rows = await captureRows((mb) => { mb.markRead('botlab', 'newsbot', [m.id]); });
    const marked = rows.filter(r => r.event === 'mark-read');
    expect(marked.length).toBe(1);
    expect(marked[0]?.data?.flipped).toBe(1);
  });

  test('손상된 꼬리가 «관측에도» 남는다 — console.warn 만이면 logs.db 에 안 닿는다', async () => {
    mbox.createTeam('botlab', ['newsbot']);
    mbox.send({ team: 'botlab', from: 'investor', to: 'newsbot', body: 'a' });
    writeFileSync(join(tmp, 'botlab', 'newsbot.mbox'), '{ 깨진 줄\n', { flag: 'a' });
    const rows = await captureRows((mb) => { mb.list('botlab', 'newsbot'); });
    const bad = rows.filter(r => r.event === 'malformed-tail');
    expect(bad.length).toBe(1);
    expect(bad[0]?.data?.parsedBefore).toBe(1);
  });
});
