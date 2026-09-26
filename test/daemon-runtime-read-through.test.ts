// S4 (2026-07-12) — standalone createDaemonRuntime도 R5 read-through를
// 기본 장착: on-disk SessionStore의 세션 id로 history.get()하면 그
// 맥락이 로드된다 (nexus 부트와 파리티). ELANOUS_SESSION_ROOT tmp 격리.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'daemon-rt-'));
  process.env.ELANOUS_SESSION_ROOT = join(root, 'sessions');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.ELANOUS_SESSION_ROOT;
});

describe('createDaemonRuntime store read-through (S4)', () => {
  test('history.get(<store session id>) hydrates from the on-disk store', async () => {
    const { createSession, appendMessage } = await import('../src/session/index.js');
    const { createDaemonRuntime } = await import('../src/boot/daemon-runtime.js');
    const s = createSession({ origin: 'tg', title: '텔레그램에서 시작' });
    const ts = new Date().toISOString();
    appendMessage(s.id, { role: 'user', content: '어제 하던 얘기', ts });
    appendMessage(s.id, { role: 'assistant', content: '이어서 하겠습니다', ts });
    const runtime = createDaemonRuntime({ tools: 'none' } as never);
    const msgs = runtime.history.get(s.id);
    expect(msgs.map((m) => [m.role, m.content])).toEqual([
      ['user', '어제 하던 얘기'],
      ['assistant', '이어서 하겠습니다'],
    ]);
    // 미지의 id는 빈 히스토리 (기존 계약 유지)
    expect(runtime.history.get('no-such-session')).toEqual([]);
  });
});

describe('C4 — wirePtyKillOnAbort', () => {
  test('kills once per signal on abort; dedupes repeat wiring; immediate-kill on pre-aborted', async () => {
    const { wirePtyKillOnAbort } = await import('../src/boot/daemon-runtime.js');
    let kills = 0;
    const ctrl = new AbortController();
    expect(wirePtyKillOnAbort(ctrl.signal, () => { kills += 1; })).toBe(true);
    // Same signal again (2nd tool call in the same turn) → deduped.
    expect(wirePtyKillOnAbort(ctrl.signal, () => { kills += 100; })).toBe(false);
    ctrl.abort();
    await new Promise((r) => setTimeout(r, 0));
    expect(kills).toBe(1);
    // Already-aborted signal (cancel raced ahead of the first tool call)
    // → kill fires immediately.
    const ctrl2 = new AbortController();
    ctrl2.abort();
    let kills2 = 0;
    wirePtyKillOnAbort(ctrl2.signal, () => { kills2 += 1; });
    expect(kills2).toBe(1);
  });
});
