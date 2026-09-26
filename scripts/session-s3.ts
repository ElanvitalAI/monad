#!/usr/bin/env bun
// ── 세션 S3 백업/복원 CLI · 2026-07-10 ────────────────────────────────────
//
// 데몬 wireSessionS3Backup 이 변경분을 상시 백업하지만, 이 CLI 로 수동 전량 백업/
// 복원/상태 확인. S3 s3://<bucket>/monad/<elanous_id>/sessions/.
//
//   bun scripts/session-s3.ts status          # S3 가용 + 로컬 세션 수
//   bun scripts/session-s3.ts backup-all       # 로컬 세션 전량 업로드 + index.json
//   bun scripts/session-s3.ts restore <id...>  # S3 → 로컬 복원(로컬에 없을 때)

import { readdirSync, existsSync } from 'node:fs';
import { sessionRoot } from '../src/session/index.js';
import { isS3Available } from '../src/storage/s3.js';
import { backupSessionFile, backupSessionIndex, restoreSessionFile, sessionS3Key } from '../src/session/s3-backup.js';

function localSessionIds(): string[] {
  try { return readdirSync(sessionRoot()).filter(f => f.endsWith('.jsonl')).map(f => f.slice(0, -'.jsonl'.length)); }
  catch { return []; }
}

function main(): void {
  const [cmd, ...args] = process.argv.slice(2);
  const avail = isS3Available();

  switch (cmd) {
    case undefined:
    case 'status': {
      const ids = localSessionIds();
      console.log(`S3 가용: ${avail ? 'yes' : 'no (aws CLI/자격 없음 → 로컬only)'}`);
      console.log(`로컬 세션: ${ids.length}건 · ${sessionRoot()}`);
      if (avail && ids[0]) console.log(`예시 키: ${sessionS3Key(ids[0])}`);
      break;
    }
    case 'backup-all': {
      if (!avail) { console.error('S3 미가용 — 백업 불가(aws 자격 확인).'); process.exit(1); }
      const ids = localSessionIds();
      let ok = 0;
      for (const id of ids) { if (backupSessionFile(id)) ok++; }
      const idx = backupSessionIndex();
      console.log(`백업 완료: ${ok}/${ids.length} 세션 · index.json ${idx ? 'ok' : 'skip'}`);
      break;
    }
    case 'restore': {
      if (!avail) { console.error('S3 미가용 — 복원 불가.'); process.exit(1); }
      if (!args.length) { console.error('restore <id...> — 세션 id 필요'); process.exit(1); }
      let ok = 0;
      for (const id of args) {
        const local = existsSync(`${sessionRoot()}/${id}.jsonl`);
        const r = restoreSessionFile(id);
        console.log(`  ${id}: ${local ? '이미 로컬' : r ? '복원됨' : 'S3에 없음/실패'}`);
        if (r) ok++;
      }
      console.log(`복원 ${ok}/${args.length}`);
      break;
    }
    default:
      console.error(`알 수 없는 명령: ${cmd}. status|backup-all|restore`);
      process.exit(1);
  }
}

main();
