#!/usr/bin/env bun
// P8c HITL 드라이런 — 매매 제안을 verify 게이트 통과 후 Pushcut(아이폰)으로
// 승인 요청 발사. executor는 주입하지 않으므로 승인해도 집행되지 않는다(안전).
//
//   bun run scripts/hitl-dryrun.ts               # 실제 게이트(장 마감이면 발사 전 정지)
//   bun run scripts/hitl-dryrun.ts --force-gate  # 게이트 강제통과 → Pushcut 발사 검증
//   bun run scripts/hitl-dryrun.ts --no-send     # 흐름만(발사 없음)
//
// 목적: "매매 승인 요청이 대표 아이폰에 도착하는가"를 실증. 실집행 leg은
// executor 미배선으로 원천 차단(--force-gate 여도 집행 안 됨).

import { buildFinanceTools } from '../src/domains/finance-tools.js';
import { runTradeHitl, type TradeIntent } from '../src/domains/trade-hitl.js';
import { loadPushcutConfig, defaultPushcutConfigPath, createPushcutClient } from '../src/pushcut/client.js';

const noSend = process.argv.includes('--no-send');
const forceGate = process.argv.includes('--force-gate');

// 드라이런 제안 (실행 안 됨을 프롬프트에 명시).
const intent: TradeIntent = {
  id: `dryrun-${Date.now()}`,
  symbol: 'KORU', side: 'buy', qty: 1,
  reason: '[드라이런·테스트] HITL 승인 플로우 실증 — 실제 매매 아님',
  source: 'user',
};

const { dispatch } = buildFinanceTools();

// Pushcut 클라이언트.
const pcfg = loadPushcutConfig(defaultPushcutConfigPath());
const pushcut = createPushcutClient(pcfg ? { config: pcfg } : {});
const NOTIF = 'monad-confirm';

async function firePushcut(prompt: string, stage: 1 | 2): Promise<{ approved: boolean; channel?: string }> {
  if (noSend || !pushcut.configured) {
    console.error(`  [HITL ${stage}차] ${noSend ? '발사 생략(--no-send)' : 'Pushcut 미구성'}`);
    return { approved: false, channel: 'skipped' };
  }
  const r = await pushcut.notify(NOTIF, {
    title: `[매매 ${stage}/2] ${intent.side.toUpperCase()} ${intent.qty} ${intent.symbol}`,
    text: prompt,
    input: intent.id,
    actions: [
      { name: '승인', shortcut: 'monad-confirm-yes', input: intent.id },
      { name: '거부', shortcut: 'monad-confirm-no', input: intent.id },
    ],
  });
  console.error(`  [HITL ${stage}차] Pushcut '${NOTIF}' 발사: ${r.ok ? '✅ 전송됨 → 아이폰 확인' : `❌ ${r.reason ?? 'fail'}`}`);
  // 드라이런: 콜백 round-trip(iOS Shortcut→daemon webhook)은 별도 검증. 여기선
  // 발사 성공만 확인하고 승인은 보류(false) → 집행 단계 도달 안 함.
  return { approved: false, channel: r.ok ? 'pushcut(발사됨·응답대기)' : 'pushcut(실패)' };
}

console.error('═══ HITL 매매 드라이런 ═══');
console.error(`제안: ${intent.side} ${intent.qty} ${intent.symbol} — ${intent.reason}`);

const result = await runTradeHitl(intent, {
  verifyGate: async () => {
    const g = await dispatch('finance_verify_gate', {}) as { gate: string };
    console.error(`  [실제 게이트] ${g.gate}`);
    if (forceGate && g.gate !== 'CLEARED') {
      console.error('  [게이트] ⚠️ --force-gate: 드라이런 위해 CLEARED로 강제(Pushcut 발사 검증용·집행은 executor 미배선으로 여전히 차단)');
      return { gate: 'CLEARED', detail: `강제(실제=${g.gate})` };
    }
    return { gate: g.gate };
  },
  requestApproval: firePushcut,
  // executor 미주입 = 하드 거부(집행 원천 차단).
  audit: (e) => console.error(`  · ${e.state}: ${e.note}`),
});

console.error('═══ 결과 ═══');
console.log(JSON.stringify({
  state: result.state,
  gate: result.gate,
  approvals: result.approvals,
  executed: result.executed,
  rejectReason: result.rejectReason,
}, null, 2));
console.error(result.executed
  ? '⚠️ executed=true (예상 밖 — 드라이런은 executor 미배선이어야 함)'
  : '✅ executed=false — 집행 안 됨(안전). 게이트/Pushcut 발사 leg만 실증.');
