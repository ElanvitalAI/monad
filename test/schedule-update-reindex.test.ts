// schedule update 시 content-hash id(cron+command) 가 바뀌며 옛 id 가 고아로 남던 버그
// (inventoryCrontab=upsert-only, 사라진 라인 미prune)와 그 수복(reindexCrontabEntry) 검증.

import { test, expect } from 'bun:test';
import { openSchedulesDb, inventoryCrontab, reindexCrontabEntry } from '../src/domains/schedule-registry.js';

const CMD = 'cd /repo && /root/.bun/bin/bun scripts/cron-run.ts scripts/foo-cycle.ts >> /tmp/foo.log 2>&1';

test('reindexCrontabEntry: cron 변경 후 옛 고아 id 의 이력/설정을 새 id 로 이관하고 고아 제거', () => {
  const db = openSchedulesDb(':memory:');

  // 1) 주간 라인 인벤토리 → 옛 id (sha1(cron+command))
  inventoryCrontab(db, { crontab: `0 3 * * 0 ${CMD}\n` });
  const oldRow = db.prepare(`SELECT id FROM schedule_registry WHERE cron = '0 3 * * 0'`).get() as { id: string };
  expect(oldRow?.id).toBeTruthy();
  // 이력(last_run)·사용자 설정(note·domain override) 부여
  db.run(`UPDATE schedule_registry SET last_run = '2026-07-01T00:00:00Z', note = '중요 잡', domain = 'ops' WHERE id = ?`, [oldRow.id]);

  // 2) update 시뮬: 핸들러는 옛 라인 제거 후 새 라인 인벤토리 → 새 id 생성.
  //    inventory 는 옛 id 행을 prune 하지 않으므로 이 시점 옛+새 = 2행(고아 발생 = 버그 재현).
  inventoryCrontab(db, { crontab: `0 3 * * * ${CMD}\n` });
  const newRow = db.prepare(`SELECT id FROM schedule_registry WHERE cron = '0 3 * * *'`).get() as { id: string };
  expect(newRow.id).not.toBe(oldRow.id); // content-hash → id 변경
  expect((db.prepare(`SELECT COUNT(*) AS c FROM schedule_registry`).get() as { c: number }).c).toBe(2);

  // 3) reindex → 이력/설정 이관 + 고아 제거
  const ok = reindexCrontabEntry(db, oldRow.id, newRow.id);
  expect(ok).toBe(true);

  const rows = db.prepare(`SELECT id, last_run, note, domain FROM schedule_registry`).all() as Array<{ id: string; last_run: string | null; note: string | null; domain: string | null }>;
  expect(rows.length).toBe(1);              // 고아 제거됨
  expect(rows[0].id).toBe(newRow.id);       // 새 id 만 남음
  expect(rows[0].last_run).toBe('2026-07-01T00:00:00Z'); // 발화 이력 보존
  expect(rows[0].note).toBe('중요 잡');       // 사용자 note 보존
  expect(rows[0].domain).toBe('ops');       // domain override 보존
  db.close();
});

test('reindexCrontabEntry: oldId===newId·부재 행이면 no-op(false)', () => {
  const db = openSchedulesDb(':memory:');
  expect(reindexCrontabEntry(db, 'same', 'same')).toBe(false);
  expect(reindexCrontabEntry(db, 'missing-old', 'missing-new')).toBe(false);
  // 새 행만 있고 옛 행이 없으면(정상 신규) no-op
  inventoryCrontab(db, { crontab: `0 9 * * 1 ${CMD}\n` });
  const only = db.prepare(`SELECT id FROM schedule_registry`).get() as { id: string };
  expect(reindexCrontabEntry(db, 'nonexistent', only.id)).toBe(false);
  db.close();
});
