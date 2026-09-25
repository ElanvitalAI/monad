// 라이브 세션 삭제 — DELETE /v1/sessions/store/:id 핸들러 테스트.
import { describe, test, expect } from 'bun:test';
import { handleSessionsStoreDelete } from '../src/nexus/api/sessions-store.js';
import { forkSessionFromHistory, loadSession } from '../src/session/index.js';
import type { MetaApiOpts } from '../src/nexus/api/meta-api.js';

const opts: MetaApiOpts = { noAuth: true };
const delReq = () => new Request('http://localhost/v1/sessions/store/x', { method: 'DELETE' });

describe('handleSessionsStoreDelete', () => {
  test('실 세션 삭제 → on-disk 제거·원본 없음', () => {
    const s = forkSessionFromHistory({
      messages: [{ role: 'user', content: '삭제 테스트' }, { role: 'assistant', content: '응' }],
      source: 'cli',
      title: 'delete-test',
    });
    expect(loadSession(s.meta.id)).not.toBeNull();
    const res = handleSessionsStoreDelete(delReq(), s.meta.id, opts);
    expect(res.status).toBe(200);
    expect(loadSession(s.meta.id)).toBeNull(); // on-disk 제거됨
  });

  test('잘못된 id(경로문자) 거부 — 400', () => {
    for (const bad of ['../etc', 'a/b', 'a\\b', '']) {
      const res = handleSessionsStoreDelete(delReq(), bad, opts);
      expect(res.status).toBe(400);
    }
  });

  test('없는 세션 — ok:true·deleted:false(멱등)', async () => {
    const res = handleSessionsStoreDelete(delReq(), 'no-such-session-id-xyz', opts);
    const body = await res.json() as { ok: boolean; deleted: boolean };
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(false);
  });
});
