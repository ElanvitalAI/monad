#!/usr/bin/env bun
// ── R2 · 적응 해상도 디깅 러너 (cron */10) ──────────────────────────
// 고영향 신호(impact/market≥8·기회보드 high) → 자동 심층분석 → 리포트 알림.
// 가드: 시간당 2회 · 동일 섹터 6h 쿨다운 · 분석만(READ-ONLY).

import { digOnce } from '../src/domains/dig-engine.js';
import { sendOutbound } from '../src/domains/outbound-alert.js';
import { recordAutonomousActionSafe } from '../src/domains/autonomy-log.js';

// 07-07 관찰 수리: homebrew/bun 주입만으론 부족(node=nvm 전용) — nvm bin 동적 주입.
import { ensureCronNodePath } from '../src/domains/cron-path.js';
ensureCronNodePath();

const msg = await digOnce();
if (msg) {
  console.log(msg);
  const sent = sendOutbound(msg, 'report');
  if (!sent) console.log('[dig] 발송 실패');
  // Autopilot P0.2 — 자율행동(심층 디깅) 회상 로깅. digOnce 는 고영향 신호
  //   (impact/market>=8·기회보드 high) 자동 심층분석만 msg 를 반환한다(그게 rationale).
  recordAutonomousActionSafe({
    loop: 'dig',
    action: msg.split('\n')[0]?.slice(0, 120) ?? '심층 디깅 리포트',
    rationale: '고영향 신호 자동 심층분석(impact/market>=8·기회보드 high) — 분석만 READ-ONLY',
    outcome: sent ? '텔레그램 report 발송' : '발송 실패',
  });
}
