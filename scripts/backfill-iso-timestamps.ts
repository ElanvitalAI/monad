#!/usr/bin/env bun
// 시간 컬럼 저장 형식 정규화 — 운영자 진입점(2026-07-27).
//
// 배경: 시간 컬럼의 저장 표준은 ISO-8601 이고(`src/time/db-window.ts`), 그 전제 위에서
// 레포의 `ORDER BY ts` 72곳을 **감싸지 않고 그대로** 둔다. 전제가 깨진 컬럼(=SQLite 공백 형식이
// 섞인 컬럼)이 발견되면 이 스크립트로 통일한다.
//
// 재발은 가드(`src/time/db-window-guard.test.ts`)가 막으므로 이 도구는 **드물게** 쓴다 —
// 외부 도구가 쓴 DB, 오래된 백업 복원, 가드 도입 이전 잔재 같은 경우다.
//
//   # 세어만 본다(기본)
//   bun scripts/backfill-iso-timestamps.ts --db ~/.elanous/conatus/community_buzz.db \
//        --table slang_dict --column last_seen
//
//   # 실제 기록
//   … --apply
//
// ⚠️ **날짜 전용 컬럼(`YYYY-MM-DD`)은 건드리지 않는다** — 도구가 형태로 걸러낸다.
//    그래도 `--apply` 전에 dry-run 수치를 눈으로 확인하라. DB 백업은 운영자 몫이다.

import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { backfillIsoTimestamps, formatBackfillResult } from '../src/time/backfill-iso.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dbPath = arg('db');
const table = arg('table');
const column = arg('column');
const apply = process.argv.includes('--apply');

if (!dbPath || !table || !column) {
  console.error('usage: bun scripts/backfill-iso-timestamps.ts --db <path> --table <t> --column <c> [--apply]');
  process.exit(2);
}
if (!existsSync(dbPath)) {
  console.error(`DB 없음: ${dbPath}`);
  process.exit(2);
}

const db = new Database(dbPath, apply ? undefined : { readonly: true });
try {
  console.log(`${apply ? '적용' : 'dry-run'} · ${dbPath}`);
  for (const r of backfillIsoTimestamps(db, [{ table, column }], { apply })) {
    console.log('  ' + formatBackfillResult(r));
  }
  if (!apply) console.log('  (기록하려면 --apply)');
} finally {
  db.close();
}
