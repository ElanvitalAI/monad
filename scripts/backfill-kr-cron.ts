#!/usr/bin/env bun
// ── KR 백필 정기화 래퍼 (A2 · 2026-07-08) ─────────────────────────────────
//
// KR_CHAINS 유니버스 코드를 backfill-kr-pykrx.py 에 stdin 으로 전달해 최신·신규
// 종목 가격을 주기 백필(INSERT OR IGNORE 멱등·기존 보존). 크론(주 1회) 권장.
// 사용: bun scripts/backfill-kr-cron.ts [years]

import { execFileSync } from 'node:child_process';
import { resolvePython } from '../src/python/resolve-python.js';
import { KR_CHAINS } from '../src/domains/sector-attractiveness.js';

const years = process.argv[2] ?? '2';
const codes = [...new Set(Object.values(KR_CHAINS).flatMap(sub => Object.values(sub).flat()))];
console.log(`KR 백필 정기화 — ${codes.length}종목 · ${years}년`);
try {
  execFileSync(resolvePython()?.path ?? 'python3', ['scripts/backfill-kr-pykrx.py', years], { input: codes.join('\n'), stdio: ['pipe', 'inherit', 'inherit'], timeout: 20 * 60_000 });
} catch (e) {
  console.error(`백필 실패: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
