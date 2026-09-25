// session_manage / monad session — 대화 세션 관리 디스패처 테스트.
//
// search(내용 검색·필터) · show(ID/prefix 전체 열람) · list(최근·telegram 필터) · delete(파괴적).
// 검색은 filesWithMatches 를 null 반환으로 강제해 rg 비의존 JS 폴백 경로를 검증.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchSessionQuery, type SessionQueryOpts } from '../src/domains/session-query-tool';

let root: string;

interface Msg { role: string; content: string; ts: string; toolName?: string }
function seedSession(id: string, messages: Msg[]): void {
  writeFileSync(join(root, `${id}.jsonl`), messages.map(m => JSON.stringify(m)).join('\n') + '\n');
}
function writeIndex(metas: Array<Record<string, unknown>>): void {
  writeFileSync(join(root, 'index.json'), JSON.stringify(metas, null, 2));
}

// Force the JS fallback (no rg dependency) — scans every *.jsonl in root.
const jsFallback: SessionQueryOpts['filesWithMatches'] = async () => null;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sess-query-'));
  const metas = [
    { id: 'aaaa1111-0000-0000-0000-000000000001', title: 'refactor turn-runner', provider: 'anthropic', model: 'opus', messageCount: 3, source: 'cli', createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-08T10:00:00Z' },
    { id: 'bbbb2222-0000-0000-0000-000000000002', title: 'telegram bug', provider: 'anthropic', model: 'opus', messageCount: 2, source: 'telegram', tgChatId: 555, tgThreadId: 0, createdAt: '2026-07-02T00:00:00Z', updatedAt: '2026-07-09T10:00:00Z' },
    { id: 'cccc3333-0000-0000-0000-000000000003', title: 'pwa bug', provider: 'anthropic', model: 'opus', messageCount: 1, source: 'pwa', createdAt: '2026-07-03T00:00:00Z', updatedAt: '2026-07-10T10:00:00Z' },
  ];
  writeIndex(metas);
  seedSession('aaaa1111-0000-0000-0000-000000000001', [
    { role: 'user', content: 'help me refactor the turn-runner spill logic', ts: '2026-07-08T09:00:00Z' },
    { role: 'assistant', content: 'sure, the overflow body spills via sendFile', ts: '2026-07-08T09:01:00Z' },
    { role: 'tool', content: 'RG_NOISE_TOKEN only in tool output', ts: '2026-07-08T09:02:00Z', toolName: 'Bash' },
  ]);
  seedSession('bbbb2222-0000-0000-0000-000000000002', [
    { role: 'user', content: 'the telegram sendDocument is failing', ts: '2026-07-09T09:00:00Z' },
    { role: 'assistant', content: 'let me check the multipart upload', ts: '2026-07-09T09:01:00Z' },
  ]);
  seedSession('cccc3333-0000-0000-0000-000000000003', [
    { role: 'user', content: 'the pwa transport is failing', ts: '2026-07-10T09:00:00Z' },
  ]);
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('dispatchSessionQuery · search', () => {
  test('content match returns the session with a snippet', async () => {
    const r = await dispatchSessionQuery({ action: 'search', query: 'refactor the turn-runner' }, { root, filesWithMatches: jsFallback }) as any;
    expect(r.count).toBe(1);
    expect(r.hits[0].sessionId).toBe('aaaa1111-0000-0000-0000-000000000001');
    expect(r.hits[0].matchCount).toBeGreaterThanOrEqual(1);
    expect(r.hits[0].snippets[0].text.toLowerCase()).toContain('refactor');
  });

  test('source filter narrows to telegram', async () => {
    const r = await dispatchSessionQuery({ action: 'search', query: 'the', source: 'telegram' }, { root, filesWithMatches: jsFallback }) as any;
    expect(r.hits.every((h: any) => h.source === 'telegram')).toBe(true);
    expect(r.hits.some((h: any) => h.sessionId.startsWith('bbbb'))).toBe(true);
  });

  test('widened PWA source filters search without ACP read-through', async () => {
    const r = await dispatchSessionQuery({ action: 'search', query: 'the', source: 'pwa' }, { root, filesWithMatches: jsFallback }) as any;
    expect(r.count).toBe(1);
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]).toMatchObject({
      sessionId: 'cccc3333-0000-0000-0000-000000000003',
      source: 'pwa',
    });
  });

  test('tgChatId filter narrows to the chat', async () => {
    const r = await dispatchSessionQuery({ action: 'search', query: 'the', tgChatId: 555 }, { root, filesWithMatches: jsFallback }) as any;
    expect(r.count).toBe(1);
    expect(r.hits[0].tgChatId).toBe(555);
  });

  test('matches only conversation content, not tool JSON', async () => {
    const r = await dispatchSessionQuery({ action: 'search', query: 'RG_NOISE_TOKEN' }, { root, filesWithMatches: jsFallback }) as any;
    // token lives only in a tool-role message → excluded from content search.
    expect(r.count).toBe(0);
  });

  test('missing query → error', async () => {
    const r = await dispatchSessionQuery({ action: 'search' }, { root }) as any;
    expect(r.error).toContain('query');
  });

  test('invalid source rejects before search exposes unfiltered matches', async () => {
    const r = await dispatchSessionQuery({ action: 'search', query: 'the', source: 'invalid' }, { root, filesWithMatches: jsFallback }) as any;
    expect(r.error).toContain('invalid session source');
    expect(r.hits).toBeUndefined();
  });
});

describe('dispatchSessionQuery · show', () => {
  test('by full id returns full transcript, tool rows excluded by default', async () => {
    const r = await dispatchSessionQuery({ action: 'show', sessionId: 'aaaa1111-0000-0000-0000-000000000001' }, { root }) as any;
    expect(r.session.title).toBe('refactor turn-runner');
    expect(r.messages).toHaveLength(2); // tool row dropped
    expect(r.messages.some((m: any) => m.role === 'tool')).toBe(false);
  });

  test('by unique prefix works; includeTools surfaces tool rows', async () => {
    const r = await dispatchSessionQuery({ action: 'show', sessionId: 'aaaa', includeTools: true }, { root }) as any;
    expect(r.session.id).toBe('aaaa1111-0000-0000-0000-000000000001');
    expect(r.messages.some((m: any) => m.role === 'tool')).toBe(true);
  });

  test('maxChars truncates message content', async () => {
    const r = await dispatchSessionQuery({ action: 'show', sessionId: 'aaaa', maxChars: 10 }, { root }) as any;
    expect(r.messages[0].content).toContain('more)');
  });

  test('unknown id → error', async () => {
    const r = await dispatchSessionQuery({ action: 'show', sessionId: 'zzzz' }, { root }) as any;
    expect(r.error).toContain('no session');
  });
});

describe('dispatchSessionQuery · list', () => {
  test('newest-first metadata list', async () => {
    const r = await dispatchSessionQuery({ action: 'list' }, { root }) as any;
    expect(r.count).toBe(3);
    expect(r.sessions[0].id).toBe('cccc3333-0000-0000-0000-000000000003'); // updated 07-10 > 07-09 > 07-08
  });

  test('source=telegram filter', async () => {
    const r = await dispatchSessionQuery({ action: 'list', source: 'telegram' }, { root }) as any;
    expect(r.count).toBe(1);
    expect(r.sessions[0].source).toBe('telegram');
  });

  test('invalid source rejects before list can widen a Telegram-scoped query', async () => {
    const r = await dispatchSessionQuery({ action: 'list', source: 'invalid', tgChatId: 555 }, { root }) as any;
    expect(r.error).toContain('invalid session source');
    expect(r.sessions).toBeUndefined();
  });

  test('widened source filters and excludeSources retain allowed values while dropping invalid values', async () => {
    const pwa = await dispatchSessionQuery({ action: 'list', source: 'pwa' }, { root }) as any;
    expect(pwa.sessions).toHaveLength(1);
    expect(pwa.sessions[0].source).toBe('pwa');

    const excluded = await dispatchSessionQuery({ action: 'list', all: true, excludeSources: ['pwa', 'invalid'] }, { root }) as any;
    expect(excluded.sessions.some((session: any) => session.source === 'pwa')).toBe(false);
    expect(excluded.count).toBe(2);
  });

  test('unknown action → error', async () => {
    const r = await dispatchSessionQuery({ action: 'bogus' }, { root }) as any;
    expect(r.error).toContain('unknown action');
  });
});

describe('dispatchSessionQuery · delete', () => {
  test('by prefix deletes and reports the title; subsequent show fails', async () => {
    const del = await dispatchSessionQuery({ action: 'delete', sessionId: 'bbbb' }, { root }) as any;
    expect(del.deleted).toBe(true);
    expect(del.id).toBe('bbbb2222-0000-0000-0000-000000000002');
    expect(del.title).toBe('telegram bug');
    // gone from list…
    const list = await dispatchSessionQuery({ action: 'list' }, { root }) as any;
    expect(list.count).toBe(2);
    // …and no longer loadable.
    const show = await dispatchSessionQuery({ action: 'show', sessionId: 'bbbb' }, { root }) as any;
    expect(show.error).toContain('no session');
  });

  test('missing sessionId → error', async () => {
    const r = await dispatchSessionQuery({ action: 'delete' }, { root }) as any;
    expect(r.error).toContain('sessionId');
  });

  test('unknown id → error (nothing deleted)', async () => {
    const r = await dispatchSessionQuery({ action: 'delete', sessionId: 'zzzz' }, { root }) as any;
    expect(r.error).toContain('no session');
  });
});

describe('dispatchSessionQuery · fleet 세션 연합 (--all-instances)', () => {
  // §10 — 등록 인스턴스들의 세션 스토어 read-only union. fleetInstances 주입으로 실 prod
  // 스캔 없이 결정론. 각 인스턴스 세션 root = `<stateDir>/sessions`.
  let dirA: string; let dirB: string;
  function seedInstance(stateDir: string, metas: Array<Record<string, unknown>>): void {
    const sroot = join(stateDir, 'sessions');
    require('node:fs').mkdirSync(sroot, { recursive: true });
    writeFileSync(join(sroot, 'index.json'), JSON.stringify(metas, null, 2));
    for (const m of metas) writeFileSync(join(sroot, `${m.id}.jsonl`), JSON.stringify({ role: 'user', content: 'x', ts: '2026-07-24T00:00:00Z' }) + '\n');
  }
  beforeEach(() => {
    dirA = mkdtempSync(join(tmpdir(), 'fleet-A-'));
    dirB = mkdtempSync(join(tmpdir(), 'fleet-B-'));
    seedInstance(dirA, [
      { id: 'a0000001-0000-0000-0000-000000000001', title: 'chat on A', messageCount: 3, source: 'cli', updatedAt: '2026-07-24T10:00:00Z' },
    ]);
    seedInstance(dirB, [
      { id: 'b0000001-0000-0000-0000-000000000001', title: 'chat on B', messageCount: 5, source: 'cli', updatedAt: '2026-07-24T11:00:00Z' },
      { id: 'b0000002-0000-0000-0000-000000000002', title: 'empty on B', messageCount: 0, source: 'cli', updatedAt: '2026-07-24T09:00:00Z' },
    ]);
  });
  afterEach(() => { rmSync(dirA, { recursive: true, force: true }); rmSync(dirB, { recursive: true, force: true }); });

  test('union across instances with instance labels, newest-first', async () => {
    const r = await dispatchSessionQuery({ action: 'list', allInstances: true }, {
      fleetInstances: [{ name: 'inst-A', stateDir: dirA }, { name: 'inst-B', stateDir: dirB }],
    }) as any;
    expect(r.fleet).toBe(true);
    expect(r.instances).toEqual(['inst-A', 'inst-B']);
    // 빈 세션 기본 숨김 → A 1건 + B 1건(비어있는 b0000002 제외).
    expect(r.count).toBe(2);
    expect(r.sessions[0].title).toBe('chat on B'); // 11:00 > 10:00
    expect(r.sessions[0].instance).toBe('inst-B');
    expect(r.sessions[1].instance).toBe('inst-A');
  });

  test('all:true 면 빈 세션도 포함', async () => {
    const r = await dispatchSessionQuery({ action: 'list', allInstances: true, all: true }, {
      fleetInstances: [{ name: 'inst-A', stateDir: dirA }, { name: 'inst-B', stateDir: dirB }],
    }) as any;
    expect(r.count).toBe(3); // A 1 + B 2(빈 세션 포함)
  });
});

describe('dispatchSessionQuery · operational sourceKind exclusion', () => {
  // Operational cron runs (sourceKind:'scheduled' — leverage/free-swing/buzz-dig
  // cycles) must not pollute the user conversation list/search by default.
  beforeEach(() => {
    writeIndex([
      { id: 'aaaa1111-0000-0000-0000-000000000001', title: 'real chat', messageCount: 4, source: 'cli', sourceKind: 'keyboard', createdAt: '2026-07-20T00:00:00Z', updatedAt: '2026-07-20T00:00:00Z' },
      { id: 'cccc0001-0000-0000-0000-000000000001', title: 'leverage-cycle', messageCount: 6, source: 'cli', sourceKind: 'scheduled', createdAt: '2026-07-24T00:00:00Z', updatedAt: '2026-07-24T00:00:00Z' },
    ]);
    seedSession('aaaa1111-0000-0000-0000-000000000001', [{ role: 'user', content: 'hello there friend', ts: '2026-07-20T00:00:00Z' }]);
    seedSession('cccc0001-0000-0000-0000-000000000001', [{ role: 'user', content: 'hello there friend', ts: '2026-07-24T00:00:00Z' }]);
  });

  test('list excludes scheduled by default', async () => {
    const r = await dispatchSessionQuery({ action: 'list', source: 'cli' }, { root }) as any;
    expect(r.count).toBe(1);
    expect(r.sessions[0].title).toBe('real chat');
  });

  test('list all:true includes scheduled', async () => {
    const r = await dispatchSessionQuery({ action: 'list', source: 'cli', all: true }, { root }) as any;
    expect(r.sessions.some((s: any) => s.title === 'leverage-cycle')).toBe(true);
  });

  test('search excludes scheduled by default but all:true includes', async () => {
    const hidden = await dispatchSessionQuery({ action: 'search', query: 'hello there friend', source: 'cli' }, { root, filesWithMatches: jsFallback }) as any;
    expect(hidden.hits.every((h: any) => h.title !== 'leverage-cycle')).toBe(true);
    const shown = await dispatchSessionQuery({ action: 'search', query: 'hello there friend', source: 'cli', all: true }, { root, filesWithMatches: jsFallback }) as any;
    expect(shown.hits.some((h: any) => h.title === 'leverage-cycle')).toBe(true);
  });
});

describe('dispatchSessionQuery · purge', () => {
  // Re-seed with leaked-fixture-shaped data: repeated titles + empties + one real
  // multi-message session that must survive every purge.
  beforeEach(() => {
    writeIndex([
      { id: 'ffff0001-0000-0000-0000-000000000001', title: 'err-test', messageCount: 0, source: 'cli', createdAt: '2026-07-05T00:00:00Z', updatedAt: '2026-07-05T00:00:00Z' },
      { id: 'ffff0002-0000-0000-0000-000000000002', title: 'err-test', messageCount: 0, source: 'cli', createdAt: '2026-07-05T00:00:00Z', updatedAt: '2026-07-05T00:00:00Z' },
      { id: 'ffff0003-0000-0000-0000-000000000003', title: 'stream-test', messageCount: 0, source: 'cli', createdAt: '2026-07-06T00:00:00Z', updatedAt: '2026-07-06T00:00:00Z' },
      { id: 'aaaa1111-0000-0000-0000-000000000001', title: 'refactor turn-runner', messageCount: 3, source: 'cli', createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-20T10:00:00Z' },
    ]);
    seedSession('ffff0001-0000-0000-0000-000000000001', []);
    seedSession('ffff0002-0000-0000-0000-000000000002', []);
    seedSession('ffff0003-0000-0000-0000-000000000003', []);
  });

  test('refuses without a narrowing predicate (전체 삭제 방지)', async () => {
    const r = await dispatchSessionQuery({ action: 'purge' }, { root }) as any;
    expect(r.error).toContain('좁힘 조건');
    // nothing deleted
    const list = await dispatchSessionQuery({ action: 'list', all: true, minMessages: 0, source: 'cli' }, { root }) as any;
    expect(list.count).toBe(4);
  });

  test('titles dry-run reports byTitle but deletes nothing', async () => {
    const r = await dispatchSessionQuery({ action: 'purge', titles: 'err-test,stream-test' }, { root }) as any;
    expect(r.dryRun).toBe(true);
    expect(r.matched).toBe(3);
    const errCount = r.byTitle.find((b: any) => b.title === 'err-test')?.count;
    expect(errCount).toBe(2);
    // still all present (dry-run)
    const list = await dispatchSessionQuery({ action: 'list', all: true, minMessages: 0, source: 'cli' }, { root }) as any;
    expect(list.count).toBe(4);
  });

  test('apply deletes matched, spares the real session', async () => {
    const r = await dispatchSessionQuery({ action: 'purge', titles: 'err-test,stream-test', apply: true }, { root }) as any;
    expect(r.purged).toBe(3);
    const show = await dispatchSessionQuery({ action: 'show', sessionId: 'aaaa1111-0000-0000-0000-000000000001' }, { root }) as any;
    expect(show.session.title).toBe('refactor turn-runner'); // survived
    const gone = await dispatchSessionQuery({ action: 'show', sessionId: 'ffff0001-0000-0000-0000-000000000001' }, { root }) as any;
    expect(gone.error).toContain('no session');
  });

  test('empty targets only 0-message sessions', async () => {
    const r = await dispatchSessionQuery({ action: 'purge', empty: true }, { root }) as any;
    expect(r.dryRun).toBe(true);
    expect(r.matched).toBe(3); // the three empties, not the 3-message real one
  });

  test('invalid source rejects before purge can delete unfiltered sessions', async () => {
    const r = await dispatchSessionQuery({ action: 'purge', source: 'invalid', empty: true, apply: true }, { root }) as any;
    expect(r.error).toContain('invalid session source');
    const remaining = await dispatchSessionQuery({ action: 'list', all: true, minMessages: 0, source: 'cli' }, { root }) as any;
    expect(remaining.count).toBe(4);
  });

  test('before filter uses updatedAt (real session updated 07-20 survives)', async () => {
    const r = await dispatchSessionQuery({ action: 'purge', before: '2026-07-10T00:00:00Z' }, { root }) as any;
    expect(r.matched).toBe(3); // fixtures updated 07-05/06; real one 07-20 excluded
  });
});

// ── purge breakdown — 리뷰 must-fix ④ (2026-08-19) ────────────────────────
//
// 왜 이 절이 있나: 이 산출로 「빈 세션 79건을 «누가» 언제 만들었나」를 물었는데
// 표본 10행밖에 없어 답할 수 없었고, 그 10행으로 낸 판정이 실제로 «틀렸다»
// (표본 10/10 이 cli/prod → 전수는 48%). 그래서 전수 축을 붙였고, 그 축의
// 경계 넷을 여기서 못 박는다.
describe('dispatchSessionQuery · purge breakdown', () => {
  const empty = (id: string, extra: Record<string, unknown>): Record<string, unknown> => ({
    id, title: 'err-test', messageCount: 0, source: 'cli',
    createdAt: '2026-07-05T00:00:00Z', updatedAt: '2026-07-05T00:00:00Z', ...extra,
  });

  test('originInstance 에 «/» 가 있어도 조합이 충돌하지 않고 원 필드가 보존된다', async () => {
    // ⛔ 종전 초안은 `${source}/${instance}` 를 키로 만들고 다시 split('/') 했다.
    //   그러면 아래 둘이 같은 키가 되거나 복원이 틀린다.
    writeIndex([
      empty('ffff0101-0000-0000-0000-000000000001', { source: 'cli', originInstance: 'a/b' }),
      empty('ffff0102-0000-0000-0000-000000000002', { source: 'cli', originInstance: 'a/b' }),
      empty('ffff0103-0000-0000-0000-000000000003', { source: 'cli/a', originInstance: 'b' }),
    ]);
    for (const id of ['ffff0101-0000-0000-0000-000000000001', 'ffff0102-0000-0000-0000-000000000002', 'ffff0103-0000-0000-0000-000000000003']) seedSession(id, []);
    const r = await dispatchSessionQuery({ action: 'purge', empty: true }, { root }) as any;
    expect(r.matched).toBe(3);
    // 두 조합이 «갈려» 있고 각 필드가 이어붙지 않은 원값이다.
    expect(r.bySource).toEqual(expect.arrayContaining([
      { source: 'cli', originInstance: 'a/b', count: 2 },
      { source: 'cli/a', originInstance: 'b', count: 1 },
    ]));
    expect(r.breakdown.bySourceDistinct).toBe(2);
  });

  test('originInstance «누락»과 실제 값 "unknown-instance" 를 같은 칸에 넣지 않는다', async () => {
    // ⛔ 이 저장소가 하루 종일 쫓던 형태 — 「없음」을 값으로 덮으면 둘이 합쳐진다.
    writeIndex([
      empty('ffff0201-0000-0000-0000-000000000001', {}),
      empty('ffff0202-0000-0000-0000-000000000002', { originInstance: 'unknown-instance' }),
    ]);
    for (const id of ['ffff0201-0000-0000-0000-000000000001', 'ffff0202-0000-0000-0000-000000000002']) seedSession(id, []);
    const r = await dispatchSessionQuery({ action: 'purge', empty: true }, { root }) as any;
    expect(r.breakdown.bySourceDistinct).toBe(2);
    const missing = r.bySource.find((row: any) => row.originInstance === undefined);
    const literal = r.bySource.find((row: any) => row.originInstance === 'unknown-instance');
    expect(missing).toEqual({ source: 'cli', count: 1 });
    expect(literal).toEqual({ source: 'cli', originInstance: 'unknown-instance', count: 1 });
  });

  test('상한 경계 — distinct 가 정확히 cap 이면 «안 잘렸고», cap+1 이면 잘렸다고 말한다', async () => {
    const build = (n: number): void => {
      const metas = Array.from({ length: n }, (_, i) =>
        empty(`ffff03${String(i).padStart(2, '0')}-0000-0000-0000-00000000000${i % 10}`, { title: `title-${i}` }));
      writeIndex(metas);
      for (const meta of metas) seedSession(String(meta.id), []);
    };

    build(40);
    const atCap = await dispatchSessionQuery({ action: 'purge', empty: true }, { root }) as any;
    expect(atCap.breakdown.breakdownCap).toBe(40);
    expect(atCap.breakdown.byTitleDistinct).toBe(40);
    // ⭐ 두 물음이 «여기서» 갈린다: 닿았지만(AtCap) 아직 안 잘렸다(Truncated).
    expect(atCap.breakdown.byTitleAtCap).toBe(true);
    expect(atCap.breakdown.byTitleTruncated).toBe(false); // 40개가 «다» 실렸다
    expect(atCap.byTitle).toHaveLength(40);

    build(41);
    const overCap = await dispatchSessionQuery({ action: 'purge', empty: true }, { root }) as any;
    expect(overCap.breakdown.byTitleDistinct).toBe(41);
    expect(overCap.breakdown.byTitleAtCap).toBe(true);
    expect(overCap.breakdown.byTitleTruncated).toBe(true);
    expect(overCap.byTitle).toHaveLength(40); // 실린 것은 여전히 40 — 그래서 «말해야» 한다
  });

  test('originInstance 가 «빈 문자열»이어도 누락과 합쳐지지 않는다', async () => {
    // ⛔ 리뷰 2차 must-fix: `m.originInstance ?` 는 "" 를 누락으로 읽는다.
    //   「빈 값」과 「없음」도 다른 값이다 — 이 저장소가 오늘 하루 쫓은 형태의 «가장 미세한» 판본.
    writeIndex([
      empty('ffff0501-0000-0000-0000-000000000001', {}),
      empty('ffff0502-0000-0000-0000-000000000002', { originInstance: '' }),
    ]);
    for (const id of ['ffff0501-0000-0000-0000-000000000001', 'ffff0502-0000-0000-0000-000000000002']) seedSession(id, []);
    const r = await dispatchSessionQuery({ action: 'purge', empty: true }, { root }) as any;
    expect(r.breakdown.bySourceDistinct).toBe(2);
    expect(r.bySource.find((row: any) => row.originInstance === '')).toEqual({ source: 'cli', originInstance: '', count: 1 });
    expect(r.bySource.find((row: any) => row.originInstance === undefined)).toEqual({ source: 'cli', count: 1 });
  });

  test('상한 경계는 bySource 축에도 «같은 계약»으로 걸린다', async () => {
    // ⭐ 리뷰 should-fix: 종전 경계 테스트가 byTitle 만 봤다. 두 축이 같은 cap 을 쓰므로 둘 다 못 박는다.
    const build = (n: number): void => {
      const metas = Array.from({ length: n }, (_, i) =>
        empty(`ffff06${String(i).padStart(2, '0')}-0000-0000-0000-00000000000${i % 10}`, { originInstance: `inst-${i}` }));
      writeIndex(metas);
      for (const meta of metas) seedSession(String(meta.id), []);
    };

    build(40);
    const atCap = await dispatchSessionQuery({ action: 'purge', empty: true }, { root }) as any;
    expect(atCap.breakdown.bySourceDistinct).toBe(40);
    expect(atCap.breakdown.bySourceAtCap).toBe(true);
    expect(atCap.breakdown.bySourceTruncated).toBe(false);
    expect(atCap.bySource).toHaveLength(40);

    build(41);
    const overCap = await dispatchSessionQuery({ action: 'purge', empty: true }, { root }) as any;
    expect(overCap.breakdown.bySourceDistinct).toBe(41);
    expect(overCap.breakdown.bySourceAtCap).toBe(true);
    expect(overCap.breakdown.bySourceTruncated).toBe(true);
    expect(overCap.bySource).toHaveLength(40);
  });

  test('창(oldest/newest)은 대상이 있을 때만 실리고, 0건이면 그 칸이 «없다»', async () => {
    writeIndex([
      empty('ffff0401-0000-0000-0000-000000000001', { updatedAt: '2026-07-09T00:00:00Z' }),
      empty('ffff0402-0000-0000-0000-000000000002', { updatedAt: '2026-08-17T00:00:00Z' }),
    ]);
    for (const id of ['ffff0401-0000-0000-0000-000000000001', 'ffff0402-0000-0000-0000-000000000002']) seedSession(id, []);
    const some = await dispatchSessionQuery({ action: 'purge', empty: true }, { root }) as any;
    expect(some.breakdown.oldestUpdatedAt).toBe('2026-07-09T00:00:00Z');
    expect(some.breakdown.newestUpdatedAt).toBe('2026-08-17T00:00:00Z');

    // ⛔ 리뷰 should-fix: 시간대 오프셋이 섞여도 «시간순»이어야 한다.
    //   문자열 정렬이면 "+09:00" 이 같은 순간의 "Z" 표기보다 뒤로 가서 extrema 가 뒤집힌다.
    writeIndex([
      empty('ffff0701-0000-0000-0000-000000000001', { updatedAt: '2026-07-09T00:00:00+09:00' }), // = 07-08T15:00Z (더 이르다)
      empty('ffff0702-0000-0000-0000-000000000002', { updatedAt: '2026-07-08T20:00:00Z' }),
    ]);
    for (const id of ['ffff0701-0000-0000-0000-000000000001', 'ffff0702-0000-0000-0000-000000000002']) seedSession(id, []);
    const tz = await dispatchSessionQuery({ action: 'purge', empty: true }, { root }) as any;
    expect(tz.breakdown.oldestUpdatedAt).toBe('2026-07-09T00:00:00+09:00');
    expect(tz.breakdown.newestUpdatedAt).toBe('2026-07-08T20:00:00Z');

    // 조건에 아무것도 안 걸리면 「0초 창」이 아니라 «칸이 없다» — 0 과 「못 잼」을 가른다.
    const none = await dispatchSessionQuery({ action: 'purge', titles: 'no-such-title' }, { root }) as any;
    expect(none.matched).toBe(0);
    expect(none.breakdown.oldestUpdatedAt).toBeUndefined();
    expect(none.breakdown.newestUpdatedAt).toBeUndefined();
    expect(none.bySource).toEqual([]);
  });
});
