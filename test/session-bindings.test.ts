// Session bindings — attach/detach primitives that power the
// TUI ↔ Telegram handoff. Each test gets a fresh sessions root so
// the on-disk index doesn't leak between cases.
//
// What the primitives guarantee:
//   - attachTelegramBinding adds bindings.telegram atomically
//   - at most one session can hold a given (chatId, threadId)
//   - re-attach to the same session is idempotent
//   - detach is a no-op when nothing was attached
//   - findSessionByTelegramChat prefers bindings over legacy source
//   - setCliBinding moves the cli flag between sessions without
//     leaving stragglers

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSession,
  attachTelegramBinding,
  detachTelegramBinding,
  unbindTelegramSession,
  findSessionByTelegramChat,
  findTelegramSession,
  setCliBinding,
  listBoundSessions,
  listSessions,
  loadSession,
  appendMessage,
  deleteSession,
} from '../src/session/index.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sessions-bind-'));
  process.env.XDG_STATE_HOME = join(root, '_state');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.XDG_STATE_HOME;
});

describe('unbindTelegramSession (/new · /clear · /reset)', () => {
  test('detaches from the chat but PRESERVES the transcript (not deleted)', () => {
    // A telegram-created session (source:telegram + tgChatId, like the bot mints).
    const s = createSession({ source: 'telegram', tgChatId: 555, title: 'tg:user' }, root);
    appendMessage(s.id, { role: 'user', content: 'past conversation', ts: '2026-07-09T10:00:00Z' }, root);
    // Resolvable by chat before /new.
    expect(findSessionByTelegramChat(555, undefined, undefined, root)?.id).toBe(s.id);

    const unbound = unbindTelegramSession(s.id, root);
    expect(unbound).not.toBeNull();

    // Chat no longer resolves it → next message starts fresh.
    expect(findSessionByTelegramChat(555, undefined, undefined, root)).toBeNull();
    // …but the transcript + index row are PRESERVED (the whole point).
    const loaded = loadSession(s.id, root);
    expect(loaded).not.toBeNull();
    expect(loaded!.messages.some(m => m.content === 'past conversation')).toBe(true);
    // Still listable (source unchanged) — reachable via `session list/show`.
    expect(listSessions({ source: 'telegram' }, root).some(m => m.id === s.id)).toBe(true);
  });

  test('also clears a bindings.telegram entry (attach-handoff sessions)', () => {
    const s = createSession({ source: 'cli' }, root);
    attachTelegramBinding(s.id, 777, undefined, root);
    expect(findSessionByTelegramChat(777, undefined, undefined, root)?.id).toBe(s.id);
    unbindTelegramSession(s.id, root);
    expect(findSessionByTelegramChat(777, undefined, undefined, root)).toBeNull();
    expect(loadSession(s.id, root)).not.toBeNull(); // preserved
  });

  test('unknown id → null (no throw)', () => {
    expect(unbindTelegramSession('nope', root)).toBeNull();
  });
});

describe('session source provenance', () => {
  test('persists an explicitly declared CLI source alongside its value', () => {
    const session = createSession({ source: 'cli' }, root);
    expect(session).toMatchObject({ source: 'cli', sourceSource: 'declared' });
    expect(listSessions({}, root).find(meta => meta.id === session.id)).toMatchObject({
      source: 'cli', sourceSource: 'declared',
    });
  });

  test('persists an explicitly declared Telegram source alongside its value', () => {
    const session = createSession({ source: 'telegram', tgChatId: 42 }, root);
    expect(session).toMatchObject({ source: 'telegram', sourceSource: 'declared' });
    expect(listSessions({}, root).find(meta => meta.id === session.id)).toMatchObject({
      source: 'telegram', sourceSource: 'declared',
    });
  });

  test('defaults an omitted source to cli and records that it was defaulted', () => {
    const session = createSession({}, root);
    expect(session).toMatchObject({ source: 'cli', sourceSource: 'default' });
    expect(listSessions({}, root).find(meta => meta.id === session.id)).toMatchObject({
      source: 'cli', sourceSource: 'default',
    });
  });
});

describe('attachTelegramBinding', () => {
  test('adds bindings.telegram on a CLI-created session', () => {
    const s = createSession({ source: 'cli' }, root);
    const updated = attachTelegramBinding(s.id, 42, undefined, root);
    expect(updated.bindings?.telegram).toEqual({ chatId: 42 });
    // `source` untouched — binding layer is orthogonal to origin
    expect(updated.source).toBe('cli');
  });

  test('preserves threadId when given', () => {
    const s = createSession({ source: 'cli' }, root);
    const updated = attachTelegramBinding(s.id, 42, 7, root);
    expect(updated.bindings?.telegram).toEqual({ chatId: 42, threadId: 7 });
  });

  test('throws on unknown session id', () => {
    expect(() => attachTelegramBinding('nonexistent', 42, undefined, root))
      .toThrow(/session not found/);
  });

  test('throws when a different session already holds (chatId, threadId)', () => {
    const a = createSession({ source: 'cli' }, root);
    const b = createSession({ source: 'cli' }, root);
    attachTelegramBinding(a.id, 42, undefined, root);
    expect(() => attachTelegramBinding(b.id, 42, undefined, root))
      .toThrow(/already attached to session/);
  });

  test('re-attaching to the SAME session is idempotent (no conflict)', () => {
    const s = createSession({ source: 'cli' }, root);
    attachTelegramBinding(s.id, 42, undefined, root);
    // Second call must not throw; the chat is already bound to us.
    const updated = attachTelegramBinding(s.id, 42, undefined, root);
    expect(updated.bindings?.telegram).toEqual({ chatId: 42 });
  });

  test('different threads in the same chatId do not clash', () => {
    const a = createSession({ source: 'cli' }, root);
    const b = createSession({ source: 'cli' }, root);
    attachTelegramBinding(a.id, 42, 1, root);
    // thread 2 is a different binding — must succeed
    expect(() => attachTelegramBinding(b.id, 42, 2, root)).not.toThrow();
  });
});

describe('detachTelegramBinding', () => {
  test('removes the binding and returns the updated meta', () => {
    const s = createSession({ source: 'cli' }, root);
    attachTelegramBinding(s.id, 42, undefined, root);
    const detached = detachTelegramBinding(s.id, root);
    expect(detached?.bindings?.telegram).toBeUndefined();
  });

  test('returns null when there was no binding (caller shows no-op)', () => {
    const s = createSession({ source: 'cli' }, root);
    const result = detachTelegramBinding(s.id, root);
    expect(result).toBeNull();
  });

  test('detaching frees the chat slot for another session', () => {
    const a = createSession({ source: 'cli' }, root);
    const b = createSession({ source: 'cli' }, root);
    attachTelegramBinding(a.id, 42, undefined, root);
    detachTelegramBinding(a.id, root);
    // b can now take the slot
    expect(() => attachTelegramBinding(b.id, 42, undefined, root)).not.toThrow();
  });

  test('preserves other bindings (e.g. cli) when only telegram is cleared', () => {
    const s = createSession({ source: 'cli' }, root);
    attachTelegramBinding(s.id, 42, undefined, root);
    setCliBinding(s.id, true, root);
    const detached = detachTelegramBinding(s.id, root);
    expect(detached?.bindings?.cli).toBe(true);
    expect(detached?.bindings?.telegram).toBeUndefined();
  });
});

describe('findSessionByTelegramChat', () => {
  test('returns session with matching bindings.telegram', () => {
    const s = createSession({ source: 'cli' }, root);
    attachTelegramBinding(s.id, 42, undefined, root);
    const hit = findSessionByTelegramChat(42, undefined, undefined, root);
    expect(hit?.id).toBe(s.id);
  });

  test('falls back to legacy source==telegram session when no binding matches', () => {
    const legacy = createSession(
      { source: 'telegram', tgChatId: 99 },
      root,
    );
    const hit = findSessionByTelegramChat(99, undefined, undefined, root);
    expect(hit?.id).toBe(legacy.id);
  });

  test('bindings-attached session wins over a legacy session for the same chat', () => {
    // Scenario: user had a legacy telegram session for chat 42, then
    // later did /telegram attach from TUI on a fresh session. The
    // fresh session's binding should take precedence — that's exactly
    // what "attach" means.
    const legacy = createSession({ source: 'telegram', tgChatId: 42 }, root);
    const fresh = createSession({ source: 'cli' }, root);
    attachTelegramBinding(fresh.id, 42, undefined, root);
    const hit = findSessionByTelegramChat(42, undefined, undefined, root);
    expect(hit?.id).toBe(fresh.id);
    expect(hit?.id).not.toBe(legacy.id);
  });

  test('returns null when neither bindings nor legacy match', () => {
    createSession({ source: 'cli' }, root);
    expect(findSessionByTelegramChat(42, undefined, undefined, root)).toBeNull();
  });

  test('thread-id is part of the lookup key', () => {
    const s = createSession({ source: 'cli' }, root);
    attachTelegramBinding(s.id, 42, 7, root);
    expect(findSessionByTelegramChat(42, 7, undefined, root)?.id).toBe(s.id);
    expect(findSessionByTelegramChat(42, 8, undefined, root)).toBeNull();
  });
});

describe('findTelegramSession — unchanged (backward compat)', () => {
  test('still ignores bindings — only looks at source==telegram', () => {
    // Back-compat contract: the legacy helper must NOT start picking
    // up cli-origin sessions that happen to have a telegram binding.
    // Call sites that want that behavior should migrate to
    // findSessionByTelegramChat explicitly.
    const cli = createSession({ source: 'cli' }, root);
    attachTelegramBinding(cli.id, 42, undefined, root);
    expect(findTelegramSession(42, undefined, root)).toBeNull();
  });
});

describe('setCliBinding', () => {
  test('sets cli=true on one session', () => {
    const s = createSession({ source: 'cli' }, root);
    const updated = setCliBinding(s.id, true, root);
    expect(updated.bindings?.cli).toBe(true);
  });

  test('moves the cli flag exclusively — clears it on others', () => {
    const a = createSession({ source: 'cli' }, root);
    const b = createSession({ source: 'cli' }, root);
    setCliBinding(a.id, true, root);
    setCliBinding(b.id, true, root);
    const bound = listBoundSessions({ channel: 'cli' }, root);
    expect(bound.map(m => m.id)).toEqual([b.id]);  // only b still holds cli
  });

  test('clearing the last binding drops the whole bindings object', () => {
    const s = createSession({ source: 'cli' }, root);
    setCliBinding(s.id, true, root);
    const cleared = setCliBinding(s.id, false, root);
    expect(cleared.bindings).toBeUndefined();
  });
});

describe('listBoundSessions', () => {
  test('filters by channel', () => {
    const cli = createSession({ source: 'cli' }, root);
    const tg = createSession({ source: 'cli' }, root);
    const plain = createSession({ source: 'cli' }, root);
    setCliBinding(cli.id, true, root);
    attachTelegramBinding(tg.id, 42, undefined, root);
    void plain; // unused bound — has no binding, must not appear
    const byCli = listBoundSessions({ channel: 'cli' }, root).map(m => m.id);
    const byTg  = listBoundSessions({ channel: 'telegram' }, root).map(m => m.id);
    expect(byCli).toEqual([cli.id]);
    expect(byTg).toEqual([tg.id]);
  });

  test('no channel arg returns every session with any binding', () => {
    const a = createSession({ source: 'cli' }, root);
    const b = createSession({ source: 'cli' }, root);
    attachTelegramBinding(a.id, 42, undefined, root);
    setCliBinding(b.id, true, root);
    const ids = new Set(listBoundSessions({}, root).map(m => m.id));
    expect(ids.has(a.id)).toBe(true);
    expect(ids.has(b.id)).toBe(true);
  });
});

describe('delete cleans bindings', () => {
  test('deleting a bound session frees the chat slot', () => {
    const a = createSession({ source: 'cli' }, root);
    attachTelegramBinding(a.id, 42, undefined, root);
    deleteSession(a.id, root);
    // Slot is free — a new session can take it
    const b = createSession({ source: 'cli' }, root);
    expect(() => attachTelegramBinding(b.id, 42, undefined, root)).not.toThrow();
    expect(findSessionByTelegramChat(42, undefined, undefined, root)?.id).toBe(b.id);
  });
});

// Multi-channel isolation — a private chat's chatId is the SAME user id
// across different bots, so the session lookup must scope by botId or the
// two channels' DMs merge into one (contaminated) session.
describe('multi-bot session isolation (botId scoping)', () => {
  const CHAT = 1301607555; // same user id — identical across bots
  const MAIN = '8799226199';
  const TRADING = '8755824181';

  test('same chatId + different botId → SEPARATE sessions', () => {
    const main = createSession({ source: 'telegram', tgChatId: CHAT, tgBotId: MAIN, title: 'main' }, root);
    // The trading bot must NOT resolve to the main bot's session…
    expect(findSessionByTelegramChat(CHAT, undefined, TRADING, root)).toBeNull();
    // …while the main bot resolves to its own.
    expect(findSessionByTelegramChat(CHAT, undefined, MAIN, root)?.id).toBe(main.id);
    // The trading bot mints its own, distinct session.
    const trading = createSession({ source: 'telegram', tgChatId: CHAT, tgBotId: TRADING, title: 'trading' }, root);
    expect(trading.id).not.toBe(main.id);
    expect(findSessionByTelegramChat(CHAT, undefined, TRADING, root)?.id).toBe(trading.id);
    expect(findSessionByTelegramChat(CHAT, undefined, MAIN, root)?.id).toBe(main.id);
  });

  test('pre-multi-channel auto-session (no tgBotId) does NOT match a bot-scoped lookup → fresh per-bot', () => {
    const legacy = createSession({ source: 'telegram', tgChatId: 42, title: 'legacy' }, root); // no tgBotId
    // Legacy (bot-agnostic) query still finds it.
    expect(findSessionByTelegramChat(42, undefined, undefined, root)?.id).toBe(legacy.id);
    // A bot-scoped lookup does NOT inherit the shared legacy session.
    expect(findSessionByTelegramChat(42, undefined, MAIN, root)).toBeNull();
  });

  test('an EXPLICIT attach binding without botId stays bot-agnostic (handoff preserved)', () => {
    const tui = createSession({ source: 'cli' }, root);
    attachTelegramBinding(tui.id, 42, undefined, root); // binding has no botId
    // Any bot's message to this chat reaches the attached session.
    expect(findSessionByTelegramChat(42, undefined, MAIN, root)?.id).toBe(tui.id);
    expect(findSessionByTelegramChat(42, undefined, TRADING, root)?.id).toBe(tui.id);
  });
});
