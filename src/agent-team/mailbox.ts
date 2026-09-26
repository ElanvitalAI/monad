// ── PFC-S1 P3: Team mailbox ──
//
// Append-only JSONL message store under ~/.elanous/team-mailbox/<team>/
// <recipient>.mbox. Each line is one serialized MailboxMessage. A team
// additionally has a .roster.json that names its members so SendMessage
// (P4) can validate recipient membership + future roster panes can
// enumerate active personnel.
//
// Why JSONL not a single blob ──
//  • Append-only is crash-safe — partial writes only lose the last line.
//  • `fs.writeFileSync(path, line + "\n", { flag: 'a' })` is atomic for
//    small lines on local POSIX filesystems, and it's a single syscall
//    so a mid-write kill doesn't leave half-encoded UTF-8.
//  • Inter-line contention between agents is acceptable: this file set
//    is single-process within one elanous session; multi-process locking
//    is a PX-6 concern.
//
// Read semantics ──
//  • list() parses lines lazily and tolerates a malformed tail (returns
//    everything before it + logs a single warning). This matches the
//    "partial-write survivor" promise above.
//  • markRead() rewrites the whole file atomically (tmp + rename) — rare
//    operation, correctness > latency.
//
// Persistence layout ──
//  .elanous/team-mailbox/
//    <team>/
//      .roster.json         ← { name, createdAt, members[] }
//      <recipient-1>.mbox   ← JSONL
//      <recipient-2>.mbox
//      ...

import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmSync,
  writeFileSync, renameSync, statSync,
} from 'node:fs';
import { elanousStateRoot } from '../autopilot/state-paths.js';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { debug } from '../debug/log.js';

export interface TeamRoster {
  name: string;
  createdAt: number;
  members: string[];
}

export interface MailboxMessage {
  /** Stable id — UUID. Used by markRead + replyTo. */
  id: string;
  /** Unix ms when the sender wrote the message. */
  ts: number;
  /** Team name (stamped at send; copied here so a future roster rename
   *  still resolves message history). */
  team: string;
  /** Sender agent name or 'user' (when a parent chat wrote it directly). */
  from: string;
  /** Recipient agent name. Must match the filename stem. */
  to: string;
  /** Optional one-line subject — used by roster panes for compact display. */
  subject?: string;
  /** Message body (markdown or mermaid). No hard cap — caller's
   *  responsibility to keep it reasonable. */
  body: string;
  /** Optional reference to a prior message id (conversational threading). */
  replyTo?: string;
  /** Read flag — starts false, flipped by markRead. */
  read: boolean;
}

/** Input accepted by send() — fields populated by the caller. id / ts /
 *  read are stamped by the mailbox. */
export type SendInput = Omit<MailboxMessage, 'id' | 'ts' | 'read'>;

export interface ListOpts {
  unreadOnly?: boolean;
  /** Keep the last N entries (after unreadOnly filter). */
  limit?: number;
}

// ── Path helpers ────────────────────────────────────────────────────

function defaultRoot(): string {
  return join(elanousStateRoot(), 'team-mailbox');
}

function sanitizeTeam(name: string): string {
  if (!name || typeof name !== 'string') {
    throw new Error('Team name must be a non-empty string');
  }
  const trimmed = name.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(trimmed)) {
    throw new Error(
      `Team name '${name}' is invalid — allowed: alphanumerics, '.', '_', '-' (not leading).`,
    );
  }
  return trimmed;
}

function sanitizeMember(name: string): string {
  if (!name || typeof name !== 'string') {
    throw new Error('Agent/member name must be a non-empty string');
  }
  const trimmed = name.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(trimmed)) {
    throw new Error(
      `Member name '${name}' is invalid — allowed: alphanumerics, '.', '_', '-' (not leading).`,
    );
  }
  return trimmed;
}

// ── TeamMailbox ─────────────────────────────────────────────────────

export class TeamMailbox {
  constructor(private readonly root: string = defaultRoot()) {}

  // ── Team lifecycle ───────────────────────────────────────────────

  createTeam(team: string, members: string[] = []): TeamRoster {
    const t = sanitizeTeam(team);
    const memberNames = members.map(sanitizeMember);
    const teamDir = join(this.root, t);
    mkdirSync(teamDir, { recursive: true });
    const rosterPath = join(teamDir, '.roster.json');
    let roster: TeamRoster;
    if (existsSync(rosterPath)) {
      // Idempotent — updating an existing team extends the member list.
      const existing = this.readRoster(rosterPath);
      const combined = Array.from(new Set([...existing.members, ...memberNames]));
      roster = { ...existing, members: combined };
    } else {
      roster = { name: t, createdAt: Date.now(), members: memberNames };
    }
    writeFileSync(rosterPath, JSON.stringify(roster, null, 2) + '\n', 'utf-8');
    return roster;
  }

  deleteTeam(team: string): boolean {
    const t = sanitizeTeam(team);
    const teamDir = join(this.root, t);
    if (!existsSync(teamDir)) return false;
    rmSync(teamDir, { recursive: true, force: true });
    return true;
  }

  listTeams(): TeamRoster[] {
    if (!existsSync(this.root)) return [];
    const out: TeamRoster[] = [];
    for (const entry of readdirSync(this.root)) {
      const teamDir = join(this.root, entry);
      const rosterPath = join(teamDir, '.roster.json');
      if (!existsSync(rosterPath)) continue;
      try { out.push(this.readRoster(rosterPath)); } catch { /* skip bad roster */ }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  getRoster(team: string): TeamRoster | null {
    const t = sanitizeTeam(team);
    const rosterPath = join(this.root, t, '.roster.json');
    if (!existsSync(rosterPath)) return null;
    try { return this.readRoster(rosterPath); } catch { return null; }
  }

  private readRoster(path: string): TeamRoster {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.name !== 'string') {
      throw new Error(`malformed roster at ${path}`);
    }
    return {
      name: parsed.name,
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
      members: Array.isArray(parsed.members) ? parsed.members.map(String) : [],
    };
  }

  // ── Send / list / markRead ───────────────────────────────────────

  send(input: SendInput): MailboxMessage {
    const team = sanitizeTeam(input.team);
    const to = sanitizeMember(input.to);
    const from = sanitizeMember(input.from);
    if (!input.body || typeof input.body !== 'string') {
      throw new Error('Mailbox.send: body must be a non-empty string');
    }
    const teamDir = join(this.root, team);
    mkdirSync(teamDir, { recursive: true });
    const msg: MailboxMessage = {
      id: `msg-${randomUUID().slice(0, 12)}`,
      ts: Date.now(),
      team,
      from,
      to,
      ...(input.subject ? { subject: input.subject } : {}),
      body: input.body,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      read: false,
    };
    const line = JSON.stringify(msg) + '\n';
    writeFileSync(join(teamDir, `${to}.mbox`), line, { flag: 'a', encoding: 'utf-8' });
    // ⛔⭐ 봇끼리 대화는 «통과했는데 관측이 0건»이었다(2026-08-26 실측: 이 디렉터리에
    //    debug.log 가 0개라 「봇들이 대화했나」를 .mbox 파일을 «열어야만» 알 수 있었다).
    //    ⇒ 그래서 경계에 계측을 둔다. 본문은 안 싣는다 — 길이만 싣는다.
    debug.log('agent-team.mailbox', 'send', {
      messageId: msg.id, team, from, to,
      bodyChars: msg.body.length,
      hasSubject: Boolean(msg.subject),
      isReply: Boolean(msg.replyTo),
      ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
    });
    return msg;
  }

  list(team: string, recipient: string, opts: ListOpts = {}): MailboxMessage[] {
    const t = sanitizeTeam(team);
    const r = sanitizeMember(recipient);
    const path = join(this.root, t, `${r}.mbox`);
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, 'utf-8');
    const lines = raw.split('\n');
    const msgs: MailboxMessage[] = [];
    let warned = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      try {
        const m = JSON.parse(line) as MailboxMessage;
        if (m && typeof m === 'object' && m.id) msgs.push(m);
      } catch {
        if (!warned) {
          // Tolerate a malformed tail — log once per list() call and
          // return the parsed prefix.
          warned = true;
          // ⛔ console.warn «만» 남기면 logs.db 에 안 닿아 조회가 불가능하다 =
          //    관측을 안 한 것이다. 둘 다 남긴다.
          debug.log('agent-team.mailbox', 'malformed-tail', {
            team: t, recipient: r, line: i + 1, parsedBefore: msgs.length,
          }, { level: 'warn' });
          // eslint-disable-next-line no-console
          console.warn(`[mailbox] malformed JSONL line at ${path}:${i + 1} — tail discarded`);
        }
        break;
      }
    }
    let filtered = opts.unreadOnly ? msgs.filter(m => !m.read) : msgs;
    if (opts.limit !== undefined && opts.limit >= 0 && filtered.length > opts.limit) {
      filtered = filtered.slice(filtered.length - opts.limit);
    }
    // ⭐ B5 의 판정은 「보냈다」가 아니라 ***「받은 쪽에 그 사람 이름으로 있나」***였다.
    //    그러니 «받는» 경계도 계측한다 — 보낸 사람 이름을 실어야 그 질문에 답할 수 있다.
    debug.log('agent-team.mailbox', 'list', {
      team: t, recipient: r,
      returned: filtered.length,
      total: msgs.length,
      unread: msgs.reduce((n, m) => (m.read ? n : n + 1), 0),
      unreadOnly: Boolean(opts.unreadOnly),
      senders: [...new Set(filtered.map(m => m.from))],
      truncatedByLimit: opts.limit !== undefined && msgs.length > filtered.length,
    });
    return filtered;
  }

  markRead(team: string, recipient: string, ids: readonly string[]): number {
    const t = sanitizeTeam(team);
    const r = sanitizeMember(recipient);
    const path = join(this.root, t, `${r}.mbox`);
    if (!existsSync(path)) return 0;
    const raw = readFileSync(path, 'utf-8');
    const lines = raw.split('\n');
    const idSet = new Set(ids);
    const outLines: string[] = [];
    let flipped = 0;
    for (const line of lines) {
      if (!line) continue;
      try {
        const m = JSON.parse(line) as MailboxMessage;
        if (idSet.has(m.id) && !m.read) { m.read = true; flipped++; }
        outLines.push(JSON.stringify(m));
      } catch {
        // Preserve the malformed line rather than drop — best-effort.
        outLines.push(line);
      }
    }
    const tmp = path + '.tmp.' + randomUUID().slice(0, 6);
    writeFileSync(tmp, outLines.join('\n') + '\n', 'utf-8');
    renameSync(tmp, path);
    debug.log('agent-team.mailbox', 'mark-read', {
      team: t, recipient: r, requested: ids.length, flipped,
    });
    return flipped;
  }

  /** Test helper — drop everything under root (does NOT touch other
   *  elanous state dirs). Not exposed as a public API to LLM tools. */
  _resetForTests(): void {
    if (!existsSync(this.root)) return;
    try {
      if (statSync(this.root).isDirectory()) {
        for (const entry of readdirSync(this.root)) {
          rmSync(join(this.root, entry), { recursive: true, force: true });
        }
      }
    } catch { /* ignore */ }
  }
}

/** Process-wide singleton using ~/.elanous/team-mailbox. Use this unless
 *  you're testing (in which case instantiate your own with a temp root). */
export const globalTeamMailbox = new TeamMailbox();
