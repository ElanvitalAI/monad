#!/usr/bin/env bun
// ── R1 · 주간 알파 추천 크론 러너 ─────────────────────────────────────
// cron: 30 20 * * 0 (일요일 20:30 KST — 주간 신호 증류 직후)
// READ-ONLY 추천 · 집행은 verify+HITL. 산출물은 alpha_reports/에 영속(R3 인제스트).

import { buildWeeklyAlphaReport } from '../src/domains/weekly-alpha.js';
import { sendOutbound } from '../src/domains/outbound-alert.js';

// 07-07 관찰 수리: homebrew/bun 주입만으론 부족(node=nvm 전용) — nvm bin 동적 주입.
import { ensureCronNodePath } from '../src/domains/cron-path.js';
import { unknownCronFlag } from '../src/domains/cron-flag-contract.js';

type WeeklyAlphaDependencies = {
  buildWeeklyAlphaReport?: typeof buildWeeklyAlphaReport;
  ensureCronNodePath?: typeof ensureCronNodePath;
  sendOutbound?: typeof sendOutbound;
  error?: typeof console.error;
  exit?: typeof process.exit;
};

export async function main(
  argv = process.argv.slice(2),
  dependencies: WeeklyAlphaDependencies = {},
): Promise<void> {
  const unknownFlag = unknownCronFlag(argv, { boolean: ['--collect-only'], valued: [] });
  if (unknownFlag) {
    (dependencies.error ?? console.error)(`⛔ 모르는 플래그: ${unknownFlag}`);
    (dependencies.exit ?? process.exit)(1);
    return;
  }

  (dependencies.ensureCronNodePath ?? ensureCronNodePath)();
  const { report, savedPath, narrated } = await (dependencies.buildWeeklyAlphaReport ?? buildWeeklyAlphaReport)();
  console.log(report);
  console.log(`\n[weekly-alpha] narrated=${narrated} saved=${savedPath ?? '(none)'}`);
  // ★ B5: --collect-only 면 발송 억제(alpha_reports/ 영속·R3 지식 인제스트가 프레임워크 피드).
  if (argv.includes('--collect-only')) console.log('[weekly-alpha] collect-only — 발송 skip(리포트 영속·R3 피드)');
  else if (!(dependencies.sendOutbound ?? sendOutbound)(report, 'report')) console.log('[weekly-alpha] 발송 실패');
}

if (import.meta.main) await main();
