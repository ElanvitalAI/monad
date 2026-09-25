#!/usr/bin/env bun
// ── Tier2 버즈 디깅 에이전트 (P3c) · 트리거/주기 · 2026-07-09 ─────────────────
//
// 급부상 top-1 종목을 runTurn 에이전트로 순간 디깅(파생·수급·뉴스·lead/lag 교차) → verdict.
// 레버리지 runTurn+Contract 계승·읽기전용(매매 격리). codex 구독(토큰0). 비용 바운드(1건/run).
// 등록: monad schedule create --cron '5,35 9-15 * * 1-5' --command 'scripts/buzz-dig-agent.ts'

import { ensureCronNodePath } from '../src/domains/cron-path.js';
ensureCronNodePath();

import { getUserConfig } from '../src/user-config.js';
import { runTurn, createRunTurnSession } from '../src/session/chat.js';
import { buildFinanceTools } from '../src/domains/finance-tools.js';
import { buildCoreTools } from '../src/domains/core-tools.js';
import { buildOmniSearchTool, dispatchOmniSearch } from '../src/skills/tools/omni-search.js';
import { buildBuzzDigContract, buildBuzzDigPrompt, buildBuzzDigTask } from '../src/domains/community-buzz/buzz-dig-contract.js';
import { openBuzzDb } from '../src/domains/community-buzz/store.js';
import { discoveryCandidates } from '../src/domains/community-buzz/discovery.js';
import { sendOutbound } from '../src/domains/outbound-alert.js';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const LOG = join(homedir(), '.monad/conatus/buzz_dig.log');
function log(s: string): void {
  console.log(s);
  try { if (!existsSync(dirname(LOG))) mkdirSync(dirname(LOG), { recursive: true }); appendFileSync(LOG, `${new Date().toISOString()} ${s}\n`); } catch { /* */ }
}

async function main(): Promise<void> {
  log('=== buzz-dig-agent 시작 ===');
  const db = openBuzzDb();
  let target: { ticker: string; titles: string[]; ratio: number; leadLag: string | null } | null = null;
  try {
    const cands = discoveryCandidates(db, { hours: 6, minRatio: 3, limit: 1 });
    if (cands.length) target = { ticker: cands[0]!.ticker, titles: cands[0]!.example ? [cands[0]!.example!] : [], ratio: cands[0]!.ratio, leadLag: cands[0]!.leadLag };
  } finally { db.close(); }
  if (!target) { log('급부상 top(ratio≥3) 없음 — 종료'); return; }
  log(`디깅 대상: ${target.ticker} (x${target.ratio}${target.leadLag ? `·${target.leadLag}` : ''})`);

  const cfg = getUserConfig();
  const contract = buildBuzzDigContract();
  log(`엔진: ${cfg.llm.provider} · ${cfg.llm.model ?? '(default)'} · 도구 ${contract.tools.join(',')}`);

  // 도구셋 조립(화이트리스트) — finance(읽기) + core(fact_check·memory_recall) + OmniSearch.
  const fin = buildFinanceTools();
  const core = buildCoreTools();
  const omniSpec = buildOmniSearchTool();
  const allow = new Set(contract.tools);
  const specs = [
    ...fin.specs.filter(s => allow.has(s.name)),
    ...core.specs.filter(s => allow.has(s.name)),
    ...(allow.has(omniSpec.name) ? [omniSpec] : []),
  ];
  const dispatch = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    if (name === omniSpec.name) return dispatchOmniSearch(args);
    if (core.names.has(name)) return core.dispatch(name, args);
    return fin.dispatch(name, args);
  };

  // 운영 크론 실행 — sourceKind:'scheduled' 태깅으로 대화 스토어 관측 오염 방지.
  const session = createRunTurnSession(cfg, { sourceKind: 'scheduled', title: 'buzz-dig' });
  let verdict = '';
  try {
    const r = await runTurn({
      userConfig: cfg, sessionId: session.id,
      userText: buildBuzzDigTask(target.ticker, target.titles, { ratio: target.ratio, leadLag: target.leadLag }),
      systemPrompt: buildBuzzDigPrompt(), tools: specs, dispatchTool: dispatch, maxTokens: 2400,
      onToolCall: (c) => log(`  tool: ${c.name}`),
    });
    verdict = (r.text ?? '').trim();
  } catch (e) { log(`runTurn 실패: ${e instanceof Error ? e.message : String(e)}`); }

  if (!verdict) { log('빈 verdict — 종료'); return; }
  log(`verdict:\n${verdict.slice(0, 600)}`);

  // bullish/bearish(neutral 아님)이면 리포트 발송(매매 격리·HITL).
  if (/VERDICT:\s*(bullish|bearish)/i.test(verdict)) {
    const msg = `🧠 버즈 디깅 — ${target.ticker} (급부상 x${target.ratio})\n\n${verdict.slice(0, 900)}`;
    try { log(`디깅 리포트 ${sendOutbound(msg, 'report') ? '발송' : '실패/보류'}`); } catch (e) { log(`발송 오류: ${e instanceof Error ? e.message : String(e)}`); }
  }
  log('=== buzz-dig-agent 완료 ===');
}

main().catch((e) => { log(`치명 오류: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
