#!/usr/bin/env bun
// ── 버즈 사전 자율진화 (P2d) · 주1회 크론 · 2026-07-09 ────────────────────────
//
// 폐루프: 버즈 제목에서 미지 고빈도 토큰 발굴 → 로컬 LLM 분류 → slang_dict 성장.
// 무거워서 상시(10분) 아님·주1회. 등록: elanous schedule create --cron '0 6 * * 1'
//   --command 'scripts/buzz-dict-evolve.ts'
// 진화 항목은 source=llm·confidence 0.6(HITL 검토 대상). seed 는 안 덮음.

import { unknownCronFlag } from '../src/domains/cron-flag-contract.js';
import { ensureCronNodePath } from '../src/domains/cron-path.js';

const unknownFlag = unknownCronFlag(process.argv, { boolean: ['--collect-only'], valued: [] });
if (unknownFlag) {
  console.error(`⛔ 모르는 플래그: ${unknownFlag}`);
  process.exit(1);
}

ensureCronNodePath();

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { openBuzzDb } from '../src/domains/community-buzz/store.js';
import { ensureSlangSeed, loadSlangEntries } from '../src/domains/community-buzz/slang-dict.js';
import { mineCandidates, classifyCandidates, addEvolvedEntries } from '../src/domains/community-buzz/dict-evolve.js';
import { makeLocalLlm, localLlmAvailable } from '../src/domains/community-buzz/local-llm.js';
import { listPendingSlang, pendingSlangCount } from '../src/domains/community-buzz/slang-review.js';
import { sendOutbound } from '../src/domains/outbound-alert.js';

const LOG = join(homedir(), '.elanous/conatus/buzz_dict_evolve.log');
function log(s: string): void {
  console.log(s);
  try { if (!existsSync(dirname(LOG))) mkdirSync(dirname(LOG), { recursive: true }); appendFileSync(LOG, `${new Date().toISOString()} ${s}\n`); } catch { /* */ }
}

async function main(): Promise<void> {
  log('=== dict-evolve 시작 ===');
  const db = openBuzzDb();
  ensureSlangSeed(db);
  try {
    const known = new Set(loadSlangEntries(db).map(e => e.term.toLowerCase()));
    const cands = mineCandidates(db, known, { hours: 168, minFreq: 5, limit: 25 });
    log(`후보 ${cands.length}건 (미지 고빈도): ${cands.slice(0, 8).map(c => `${c.term}(${c.freq})`).join(' ')}`);
    if (cands.length === 0) { log('후보 없음 — 종료'); return; }

    const up = await localLlmAvailable();
    if (!up.length) { log('로컬 LLM 없음 — 분류 스킵'); return; }
    const llm = makeLocalLlm({ endpoints: up });

    const proposals = await classifyCandidates(cands, llm);
    log(`분류 제안 ${proposals.length}건: ${proposals.map(p => `${p.term}→${p.type}${p.ticker ? `(${p.ticker})` : ''}`).join(' ')}`);
    const added = addEvolvedEntries(db, proposals, 'llm', 0.6);
    const pending = pendingSlangCount(db);
    log(`사전 성장 +${added} (source=llm·검토대기·정규화 미반영). 총 사전 ${loadSlangEntries(db).length} · 검토대기 ${pending}`);

    // 정보성 알림 — 새 항목은 즉시 반영됨(수동 승인 불필요). 오탐만 사후 reject.
    if (added > 0) {
      const sample = listPendingSlang(db).slice(0, 8)
        .map(p => `• ${p.term}→${p.canonical}[${p.type}${p.ticker ? `:${p.ticker}` : ''}]`).join('\n');
      const text = `🔤 버즈 사전 자율진화 — 신규 ${added}건 자동 반영 (미확정 ${pending})\n${sample}\n\n문제 항목만: bun scripts/buzz-dict-review.ts reject <term>`;
      // ★ B5: --collect-only 면 발송 억제(사전은 계속 성장·프레임워크 정규화 개선·발송만 skip).
      if (process.argv.includes('--collect-only')) log(`collect-only — 사전 ${added}건 반영·발송 skip`);
      else try { sendOutbound(text, 'alert'); } catch (e) { log(`알림 실패: ${e instanceof Error ? e.message : String(e)}`); }
    }
    log('=== dict-evolve 완료 ===');
  } finally { db.close(); }
}

main().catch((e) => { log(`치명 오류: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
