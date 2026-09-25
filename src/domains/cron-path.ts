// ── 크론 PATH 자립 (2026-07-07 아침 실운영 관찰 수리) ─────────────────
//
// cron의 최소 PATH(/usr/bin:/bin)엔 node/npx가 없고, 이 머신의 node는
// nvm 전용(homebrew 미설치) → npx shell-out(fetchEodCloses·omni-crawl·
// bulk eod·finance tools)이 크론에서만 침묵 실패. 실측 증상:
//   · capstone-alert 08:30 — EOD 조회 실패 → reliable=false → 발송 skip(여러 날)
//   · koru-reentry 08:35 — "EWY 히스토리 부족/시세 조회 실패" skip
//   · us-pulse 06:35 결산 — bulk 0건 → "신규 세션 없음" 오탐 skip
//   · dig-runner — omni-crawl 검색 컨텍스트 silent 저하
// 처방 = run-attractiveness-refresh.sh(07-06 "0 symbol" 수리)의 TS판:
// 최신 nvm bin을 동적 주입(버전 내성). 기존 homebrew/bun 주입만으론 부족.

import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 크론 진입 스크립트 최상단에서 호출 — process.env.PATH에 최신 nvm bin +
 *  homebrew + bun을 선두 주입(멱등·이미 있으면 무해). */
export function ensureCronNodePath(): void {
  let nvmBin = '';
  try {
    const base = join(homedir(), '.nvm/versions/node');
    const versions = readdirSync(base)
      .filter(v => v.startsWith('v'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const latest = versions[versions.length - 1];
    if (latest) nvmBin = join(base, latest, 'bin');
  } catch { /* nvm 미설치 — homebrew/system node에 기대 */ }
  // ⚠️ pyenv shims를 homebrew보다 앞에 — 없으면 /opt/homebrew/bin/python3
  // (모듈 미설치)가 pyenv python3(requests/dotenv 보유)를 가려서 kr-flow 등
  // python 스킬 shell-out이 exit 1 침묵 실패 (2026-07-07 워치 배선에서 실측).
  process.env.PATH = [
    join(homedir(), '.pyenv/shims'),
    nvmBin,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(homedir(), '.bun/bin'),
    process.env.PATH || '',
  ].filter(Boolean).join(':');
}
