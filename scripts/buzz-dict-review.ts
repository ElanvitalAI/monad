#!/usr/bin/env bun
// ── 버즈 사전 사후 검토 CLI — 자율 제안(source=llm/cooccur) 확정/제거 · 2026-07-10 ──
//
// dict-evolve(P2d)가 로컬 LLM으로 발굴·분류한 은어는 **바로 라이브**로 정규화에 쓰인다
// (대표 방침: 수동 승인 불필요). 이 CLI 는 선택적 사후 정리 — 오탐만 reject, 오래 검증된
// 항목은 approve 로 확정(재분류 방지). 강제 게이트 아님.
//
//   bun scripts/buzz-dict-review.ts               # 미확정(자율) 항목 목록(기본)
//   bun scripts/buzz-dict-review.ts reject ai     # 오탐 제거
//   bun scripts/buzz-dict-review.ts approve 반도체 # 확정(고정)
//   bun scripts/buzz-dict-review.ts approve-all   # 전량 확정

import { openBuzzDb } from '../src/domains/community-buzz/store.js';
import { ensureSlangSeed } from '../src/domains/community-buzz/slang-dict.js';
import { listPendingSlang, approveSlang, rejectSlang, approveAllPendingSlang, pendingSlangCount } from '../src/domains/community-buzz/slang-review.js';

function printPending(db: ReturnType<typeof openBuzzDb>): void {
  const pending = listPendingSlang(db);
  if (!pending.length) { console.log('미확정 자율 항목 없음 — 전부 확정(hitl) 또는 seed.'); return; }
  console.log(`미확정 자율 항목 ${pending.length}건 (source=llm/cooccur · 이미 라이브 정규화 사용중):\n`);
  for (const p of pending) {
    const extra = p.type === 'ticker' ? `→${p.ticker ?? '(코드없음)'}` : p.type === 'sentiment' ? `(${p.polarity})` : '';
    console.log(`  ${p.term}  →  ${p.canonical}  [${p.type}${extra}]  conf ${p.confidence}  ${p.source}`);
  }
  console.log('\n오탐 제거: reject <term...> · 확정(고정): approve <term...> · 전량확정: approve-all');
}

function main(): void {
  const [cmd, ...terms] = process.argv.slice(2);
  const db = openBuzzDb();
  ensureSlangSeed(db);
  try {
    switch (cmd) {
      case undefined:
      case 'list':
        printPending(db);
        break;
      case 'approve': {
        if (!terms.length) { console.error('approve <term...> — 승인할 용어 필요'); process.exit(1); }
        const n = approveSlang(db, terms);
        console.log(`승인 ${n}건 (source=hitl·활성 정규화 편입). 남은 대기 ${pendingSlangCount(db)}건.`);
        break;
      }
      case 'reject': {
        if (!terms.length) { console.error('reject <term...> — 기각할 용어 필요'); process.exit(1); }
        const n = rejectSlang(db, terms);
        console.log(`기각 ${n}건 (삭제). 남은 대기 ${pendingSlangCount(db)}건.`);
        break;
      }
      case 'approve-all': {
        const n = approveAllPendingSlang(db);
        console.log(`전량 승인 ${n}건 (source=hitl).`);
        break;
      }
      default:
        console.error(`알 수 없는 명령: ${cmd}. list|approve|reject|approve-all`);
        process.exit(1);
    }
  } finally { db.close(); }
}

main();
